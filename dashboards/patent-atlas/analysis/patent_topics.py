"""특허 LDA 토픽모델링 → 연도별 궤적 + 4분면 포지셔닝 + 출원인 토픽 프로파일"""
import csv, json, re, collections
import numpy as np

SRC = "/Users/home/Desktop/카이스트/2025.하반기/이노베이션 경영/4.특허분석/1.데이터/(최종) patent_raw.csv"
rows = list(csv.reader(open(SRC, encoding='cp949')))
H = rows[0]; DATA = rows[1:]
I = {c: i for i, c in enumerate(H)}

def std_applicant(name):
    n = re.sub(r'[^a-z0-9\s]', ' ', str(name).lower())
    for key, label in [('applied materials','Applied Materials'),('tokyo electron','Tokyo Electron'),
        ('samsung','Samsung Electronics'),('taiwan semiconductor','TSMC'),('semes','SEMES'),
        ('asm ip','ASM International'),('asm international','ASM International'),
        ('lam research','Lam Research'),('hitachi','Hitachi High-Tech'),('hynix','SK hynix'),
        ('kokusai','Kokusai Electric'),('micron','Micron'),('intel','Intel'),
        ('screen holdings','SCREEN Holdings'),('jusung','Jusung Engineering')]:
        if key in n: return label
    return None

apps = [std_applicant(r[I['출원인']].split('|')[0]) or 'Other' for r in DATA]
years = []
for r in DATA:
    d = r[I['등록일']].strip()
    years.append(int(d[:4]) if len(d) >= 4 and d[:4].isdigit() else None)

texts = [(r[I['발명의 명칭']] + ' ' + r[I['요약']][:700]).lower() for r in DATA]

from sklearn.feature_extraction.text import CountVectorizer
from sklearn.decomposition import LatentDirichletAllocation

STOP = """a an the of and or for to in on with by at from is are be as that this which said method
apparatus system device substrate include includes including comprising least one first second may also
such use used using provide provides embodiment embodiments present invention having each other than into
within about between may being can configured according thereof therein wherein based upon along same different
more most some any all its their they it these those there when while during through over under above below""".split()

cv = CountVectorizer(max_features=5000, min_df=8, max_df=0.40, stop_words=STOP, ngram_range=(1, 2))
X = cv.fit_transform(texts)
vocab = np.array(cv.get_feature_names_out())
print("문서-단어:", X.shape)

K = 11
lda = LatentDirichletAllocation(n_components=K, random_state=42, learning_method='batch',
                                max_iter=50, doc_topic_prior=0.1, topic_word_prior=0.01)
W = lda.fit_transform(X)              # (N, K) 문서-토픽 비중
W = W / W.sum(axis=1, keepdims=True)
print("문서-토픽:", W.shape)

topics = []
for k in range(K):
    comp = lda.components_[k]
    kws = list(vocab[comp.argsort()[::-1][:12]])
    dom = int((W.argmax(axis=1) == k).sum())
    topics.append({'id': k, 'keywords': kws, 'n_dom': dom,
                   'share_all': round(float(W[:, k].mean()), 4)})
    print(f"[T{k}] 지배문서 {dom:4d} · 평균비중 {W[:,k].mean():.3f} | {', '.join(kws[:7])}")

# ---------- 연도별 토픽 비중 ----------
YRS = [2021, 2022, 2023, 2024, 2025]
year_share = {}
for y in YRS:
    m = np.array([yy == y for yy in years])
    year_share[y] = W[m].mean(axis=0) if m.sum() else np.zeros(K)
    print(f"{y}: n={m.sum()}")

# 3년 이동평균 (보고서와 동일한 스무딩)
smooth = {}
for i, y in enumerate(YRS):
    lo = max(0, i - 2)
    smooth[y] = np.mean([year_share[YRS[j]] for j in range(lo, i + 1)], axis=0)

# ---------- 4분면 포지셔닝 ----------
xs = np.arange(len(YRS), dtype=float)
pos = []
for k in range(K):
    ys = np.array([year_share[y][k] for y in YRS])
    slope = float(np.polyfit(xs, ys, 1)[0])
    pos.append({'id': k, 'last': round(float(ys[-1]), 4), 'slope': round(slope, 5),
                'first': round(float(ys[0]), 4)})
med_share = float(np.median([p['last'] for p in pos]))
for p in pos:
    hi_share = p['last'] >= med_share
    hi_grow = p['slope'] >= 0
    p['quad'] = ('breakout' if hi_share else 'emerging') if hi_grow else ('stable' if hi_share else 'declining')
print(f"\n중앙값 비중 {med_share:.4f}")
for p in pos:
    print(f"  T{p['id']}: last={p['last']:.4f} slope={p['slope']:+.5f} → {p['quad']}")

# ---------- 출원인별 토픽 평균비중 ----------
TOP_APPS = ['Applied Materials', 'TSMC', 'Samsung Electronics', 'Tokyo Electron',
            'Lam Research', 'SEMES', 'ASM International']
app_topic = []
for a in TOP_APPS:
    m = np.array([x == a for x in apps])
    if m.sum() < 30: continue
    prof = W[m].mean(axis=0)
    # 출원인별 성장률: 최근 5년 자사 토픽비중 변화가 아닌, 전체 포트폴리오의 신생토픽 지향도
    ys_by_year = []
    for y in YRS:
        mm = m & np.array([yy == y for yy in years])
        ys_by_year.append(W[mm].mean(axis=0) if mm.sum() >= 5 else prof)
    ys_by_year = np.array(ys_by_year)
    # 집중도(HHI) : 포트폴리오가 특정 토픽에 몰려 있는가
    hhi = float((prof ** 2).sum())
    # 성장토픽 지향도 : 성장(slope>0) 토픽에 배분된 비중
    grow_topics = [p['id'] for p in pos if p['slope'] >= 0]
    grow_w = float(prof[grow_topics].sum())
    app_topic.append({'name': a, 'n': int(m.sum()),
                      'profile': [round(float(v), 4) for v in prof],
                      'hhi': round(hhi, 4), 'grow_w': round(grow_w, 4),
                      'top_topic': int(prof.argmax())})
    print(f"{a:22s} n={m.sum():4d} HHI={hhi:.3f} 성장토픽비중={grow_w:.3f} 최대토픽=T{prof.argmax()}")

med_hhi = float(np.median([a['hhi'] for a in app_topic]))
med_grow = float(np.median([a['grow_w'] for a in app_topic]))
for a in app_topic:
    hi_focus = a['hhi'] >= med_hhi
    hi_grow = a['grow_w'] >= med_grow
    a['quad'] = ('specialist_growth' if hi_focus else 'diversified_growth') if hi_grow \
                else ('specialist_mature' if hi_focus else 'diversified_mature')

out = {
    'k': K, 'years': YRS,
    'topics': topics,
    'year_share': {str(y): [round(float(v), 4) for v in year_share[y]] for y in YRS},
    'year_smooth': {str(y): [round(float(v), 4) for v in smooth[y]] for y in YRS},
    'position': pos, 'med_share': round(med_share, 4),
    'app_topic': app_topic, 'med_hhi': round(med_hhi, 4), 'med_grow': round(med_grow, 4),
}
json.dump(out, open('patent_topics.json', 'w'), ensure_ascii=False, indent=1)
print("\n저장: patent_topics.json")
