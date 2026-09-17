"""반도체 식각·플라즈마 공정 특허 8,993건 분석 → Atlas 맵 + 차트 데이터 생성"""
import csv, json, re, collections, sys
import numpy as np

SRC = "/Users/home/Desktop/카이스트/2025.하반기/이노베이션 경영/4.특허분석/1.데이터/(최종) patent_raw.csv"

rows = list(csv.reader(open(SRC, encoding='cp949')))
H = rows[0]; DATA = rows[1:]
I = {c: i for i, c in enumerate(H)}
print(f"로드: {len(DATA)}건")

# ---------- 출원인 표준화 ----------
def std_applicant(name):
    n = re.sub(r'[^a-z0-9\s]', ' ', str(name).lower())
    n = re.sub(r'\s+', ' ', n).strip()
    rules = [
        ('applied materials', 'Applied Materials'), ('tokyo electron', 'Tokyo Electron'),
        ('samsung', 'Samsung Electronics'), ('taiwan semiconductor', 'TSMC'),
        ('semes', 'SEMES'), ('asm ip', 'ASM International'), ('asm international', 'ASM International'),
        ('lam research', 'Lam Research'), ('hitachi', 'Hitachi High-Tech'),
        ('sk hynix', 'SK hynix'), ('hynix', 'SK hynix'), ('kokusai', 'Kokusai Electric'),
        ('micron', 'Micron'), ('intel', 'Intel'), ('screen holdings', 'SCREEN Holdings'),
        ('wonik', 'Wonik IPS'), ('jusung', 'Jusung Engineering'), ('mattson', 'Mattson'),
        ('beijing naura', 'NAURA'), ('naura', 'NAURA'), ('tes co', 'TES'),
    ]
    for key, label in rules:
        if key in n:
            return label
    return None

apps = []
for r in DATA:
    raw = r[I['출원인']].split('|')[0].strip()
    apps.append(std_applicant(raw) or (raw[:28] if raw else 'Unknown'))

app_count = collections.Counter(apps)
print("\n[상위 출원인]")
for a, c in app_count.most_common(12):
    print(f"  {a}: {c}")

# ---------- 연도 ----------
years = []
for r in DATA:
    d = r[I['등록일']].strip()
    years.append(int(d[:4]) if len(d) >= 4 and d[:4].isdigit() else None)
year_count = collections.Counter(y for y in years if y)

# ---------- IPC ----------
def ipc_sub(code):
    c = str(code).strip().upper()
    m = re.match(r'([A-H]\d{2}[A-Z])', c)
    return m.group(1) if m else None

ipc_main, ipc_all_lists = [], []
for r in DATA:
    m = ipc_sub(r[I['Original IPC Main']])
    ipc_main.append(m)
    subs = set()
    for j, c in enumerate(H):
        if c == 'Original IPC All' and j < len(r):
            s = ipc_sub(r[j])
            if s: subs.add(s)
    if m: subs.add(m)
    ipc_all_lists.append(sorted(subs))

ipc_count = collections.Counter(m for m in ipc_main if m)
print("\n[IPC 서브클래스]", ipc_count.most_common(8))

# ---------- 인용 ----------
def num(v):
    try: return int(float(str(v).strip() or 0))
    except: return 0

fwd = [num(r[I['피인용 문헌 수(F1)']]) for r in DATA]   # 피인용 = 영향력
bwd = [num(r[I['인용 문헌 수(B1)']]) for r in DATA]     # 인용
conv = [len(l) for l in ipc_all_lists]                  # 융합도 = IPC 종류 수
fam = [num(r[I['WIPS패밀리 국가 수(출원기준)']]) for r in DATA]  # 패밀리 국가수 = 시장성
claims = [num(r[I['청구항 수']]) for r in DATA]

print(f"\n피인용 평균 {np.mean(fwd):.2f} / 최대 {max(fwd)}")
print(f"융합도 평균 {np.mean(conv):.2f} / 최대 {max(conv)}")

# ---------- 텍스트 임베딩 → 2D ----------
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.decomposition import TruncatedSVD
from sklearn.manifold import TSNE
from sklearn.cluster import KMeans

texts = [(r[I['발명의 명칭']] + ' ' + r[I['요약']][:600]).lower() for r in DATA]
STOP = 'a an the of and or for to in on with by at from is are be as that this which said method apparatus system device substrate include includes including comprising least one first second may also such use used using provide provides embodiment embodiments present invention having each other than into within about between'.split()
tfidf = TfidfVectorizer(max_features=6000, min_df=5, max_df=0.35,
                        stop_words=STOP, ngram_range=(1, 2))
X = tfidf.fit_transform(texts)
print(f"\nTF-IDF: {X.shape}")

svd = TruncatedSVD(n_components=50, random_state=42)
Z = svd.fit_transform(X)
print(f"SVD 설명분산: {svd.explained_variance_ratio_.sum():.3f}")

K = 16
km = KMeans(n_clusters=K, random_state=42, n_init=10)
labels = km.fit_predict(Z)

# 클러스터 대표 키워드
terms = np.array(tfidf.get_feature_names_out())
cluster_terms = []
for k in range(K):
    mask = labels == k
    centroid = np.asarray(X[mask].mean(axis=0)).ravel()
    top = terms[centroid.argsort()[::-1][:8]]
    cluster_terms.append(list(top))
    print(f"[C{k}] n={mask.sum():4d} | {', '.join(top[:6])}")

# 지도용 샘플 (렌더링 성능)
rng = np.random.default_rng(42)
SAMPLE = 1800
idx = rng.choice(len(DATA), size=min(SAMPLE, len(DATA)), replace=False)
idx.sort()

print("\nt-SNE 계산 중...")
ts = TSNE(n_components=2, random_state=42, perplexity=35, init='pca',
          learning_rate='auto', max_iter=750)
P = ts.fit_transform(Z[idx])
P = (P - P.mean(0)) / P.std(0)  # 표준화
print("완료:", P.shape)

points = []
for n, i in enumerate(idx):
    points.append({
        'x': round(float(P[n, 0]), 3), 'y': round(float(P[n, 1]), 3),
        'c': int(labels[i]),
        't': DATA[i][I['발명의 명칭']][:70],
        'a': apps[i], 'y2': years[i] or 0,
        'f': fwd[i], 'ipc': ipc_main[i] or '',
    })

# 클러스터별 통계 (전체 데이터 기준)
clusters = []
for k in range(K):
    mask = labels == k
    ip = collections.Counter(ipc_main[i] for i in range(len(DATA)) if mask[i] and ipc_main[i])
    ap = collections.Counter(apps[i] for i in range(len(DATA)) if mask[i])
    clusters.append({
        'id': k, 'n': int(mask.sum()), 'terms': cluster_terms[k],
        'ipc_top': ip.most_common(3), 'app_top': ap.most_common(3),
        'fwd_mean': round(float(np.mean([fwd[i] for i in range(len(DATA)) if mask[i]])), 2),
        'conv_mean': round(float(np.mean([conv[i] for i in range(len(DATA)) if mask[i]])), 2),
    })

# ---------- 전략맵 (출원인별) ----------
strategy = []
for a, c in app_count.most_common(14):
    if a == 'Unknown' or c < 60: continue
    ii = [i for i in range(len(DATA)) if apps[i] == a]
    strategy.append({
        'name': a, 'n': len(ii),
        'fwd': round(float(np.mean([fwd[i] for i in ii])), 2),
        'conv': round(float(np.mean([conv[i] for i in ii])), 2),
        'fam': round(float(np.mean([fam[i] for i in ii])), 2),
        'claims': round(float(np.mean([claims[i] for i in ii])), 1),
    })

# ---------- IPC 공동출현 네트워크 ----------
pair = collections.Counter()
for l in ipc_all_lists:
    for a in range(len(l)):
        for b in range(a + 1, len(l)):
            pair[(l[a], l[b])] += 1
top_pairs = [{'s': a, 't': b, 'w': w} for (a, b), w in pair.most_common(20)]

# ---------- 출원인 × IPC 매트릭스 ----------
top_apps = [a for a, _ in app_count.most_common(8) if a != 'Unknown'][:6]
top_ipcs = [k for k, _ in ipc_count.most_common(5)]
matrix = []
for a in top_apps:
    row = {'app': a}
    for ipc in top_ipcs:
        row[ipc] = sum(1 for i in range(len(DATA)) if apps[i] == a and ipc_main[i] == ipc)
    matrix.append(row)

# ---------- 연도별 IPC 추이 ----------
yi = collections.defaultdict(lambda: collections.Counter())
for i in range(len(DATA)):
    if years[i] and years[i] >= 2021 and ipc_main[i]:
        yi[years[i]][ipc_main[i]] += 1
year_ipc = {str(y): {k: yi[y][k] for k in top_ipcs} for y in sorted(yi)}

out = {
    'meta': {'n_total': len(DATA), 'n_mapped': len(points), 'k': K,
             'n_applicants': len(app_count), 'n_ipc': len(ipc_count),
             'fwd_mean': round(float(np.mean(fwd)), 2), 'conv_mean': round(float(np.mean(conv)), 2)},
    'points': points, 'clusters': clusters,
    'year_count': sorted(year_count.items()),
    'app_top': app_count.most_common(12),
    'ipc_top': ipc_count.most_common(10),
    'strategy': strategy, 'ipc_pairs': top_pairs,
    'matrix': matrix, 'top_ipcs': top_ipcs, 'year_ipc': year_ipc,
    'fwd_dist': collections.Counter(min(f, 10) for f in fwd).most_common(),
}
json.dump(out, open('patent_atlas.json', 'w'), ensure_ascii=False)
print("\n저장 완료: patent_atlas.json")
print("전략맵:", [(s['name'], s['fwd'], s['conv']) for s in strategy[:5]])
