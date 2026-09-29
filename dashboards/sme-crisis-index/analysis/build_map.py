"""시도 행정경계를 단순화해 SVG 경로로 변환한다.

실행:  python3 analysis/build_map.py
입력:  KOSTAT 2018 시도 경계 GeoJSON (아래 SRC, 최초 1회 내려받아 캐시)
산출:  data/kmap.json  — {name: "M… Z"} 형태의 SVG path 모음

원본 GeoJSON 은 7.5MB 로 정적 페이지에 그대로 실을 수 없다. 여기서
  1) 면적이 작은 섬은 버리고
  2) Douglas-Peucker 로 꼭짓점을 줄이고
  3) 경위도를 viewBox 좌표로 미리 투영해
클라이언트가 topojson 라이브러리 없이 <path> 만 그리면 되게 만든다.
"""
import json, math, pathlib, urllib.request

HERE = pathlib.Path(__file__).parent
CACHE = HERE / "_kmap_src.json"
OUT = HERE.parent / "data" / "kmap.json"
SRC = ("https://raw.githubusercontent.com/southkorea/southkorea-maps/"
       "master/kostat/2018/json/skorea-provinces-2018-geo.json")

W, H = 420, 560          # viewBox
TOL = 0.006              # 단순화 허용오차(도 단위). 클수록 거칠어진다
MIN_AREA = 0.004         # 이보다 작은 폴리곤(섬)은 버린다

SHORT = {
    "서울특별시": "서울", "부산광역시": "부산", "대구광역시": "대구",
    "인천광역시": "인천", "광주광역시": "광주", "대전광역시": "대전",
    "울산광역시": "울산", "세종특별자치시": "세종", "경기도": "경기",
    "강원도": "강원", "충청북도": "충북", "충청남도": "충남",
    "전라북도": "전북", "전라남도": "전남", "경상북도": "경북",
    "경상남도": "경남", "제주특별자치도": "제주",
}


def ring_area(pts):
    """신발끈 공식. 섬 크기 비교용이라 부호는 무시한다."""
    a = 0.0
    for i in range(len(pts) - 1):
        a += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1]
    return abs(a) / 2


def simplify(pts, tol):
    """Douglas-Peucker. 재귀 대신 스택으로 처리해 깊은 해안선에서도 안전하다."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        s, e = stack.pop()
        x1, y1 = pts[s]
        x2, y2 = pts[e]
        dx, dy = x2 - x1, y2 - y1
        den = math.hypot(dx, dy)
        far, fd = -1, 0.0
        for i in range(s + 1, e):
            x0, y0 = pts[i]
            d = (abs(dy * x0 - dx * y0 + x2 * y1 - y2 * x1) / den) if den else math.hypot(x0 - x1, y0 - y1)
            if d > fd:
                far, fd = i, d
        if far > 0 and fd > tol:
            keep[far] = True
            stack.append((s, far))
            stack.append((far, e))
    return [p for p, k in zip(pts, keep) if k]


def main():
    if not CACHE.exists():
        print("경계 GeoJSON 내려받는 중 …")
        CACHE.write_bytes(urllib.request.urlopen(SRC, timeout=120).read())
    geo = json.loads(CACHE.read_text(encoding="utf-8"))

    # 전체 경위도 범위로 투영 계수를 잡는다
    xs, ys = [], []
    for f in geo["features"]:
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        for poly in polys:
            for x, y in poly[0]:
                xs.append(x); ys.append(y)
    x0, x1 = min(xs), max(xs)
    y0, y1 = min(ys), max(ys)
    # 위도에 따른 경도 축소를 반영(메르카토르 대신 단순 코사인 보정)
    kx = math.cos(math.radians((y0 + y1) / 2))
    sx = W / ((x1 - x0) * kx)
    sy = H / (y1 - y0)
    sc = min(sx, sy) * 0.95
    ox = (W - (x1 - x0) * kx * sc) / 2
    oy = (H - (y1 - y0) * sc) / 2

    def proj(x, y):
        return (round((x - x0) * kx * sc + ox, 1),
                round(H - ((y - y0) * sc + oy), 1))

    # 1차 투영 결과를 모아 실제 점유 범위를 재서 여백 없이 다시 맞춘다
    raw = {}
    for f in geo["features"]:
        name = SHORT.get(f["properties"].get("name", ""), f["properties"].get("name", ""))
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        biggest = max(ring_area(p[0]) for p in polys)
        rings = []
        for poly in polys:
            ring = poly[0]
            if ring_area(ring) < max(MIN_AREA, biggest * 0.02):
                continue                                  # 잔섬 제거
            pts = simplify(ring, TOL)
            if len(pts) < 4:
                continue
            rings.append([proj(*q) for q in pts])
        raw[name] = rings

    # ── 여백 제거: 실제 점유 범위를 viewBox 에 꽉 채운다 ──
    ax = [q[0] for rs in raw.values() for r in rs for q in r]
    ay = [q[1] for rs in raw.values() for r in rs for q in r]
    bx0, bx1, by0, by1 = min(ax), max(ax), min(ay), max(ay)
    PAD = 10
    k = min((W - PAD * 2) / (bx1 - bx0), (H - PAD * 2) / (by1 - by0))
    dx = (W - (bx1 - bx0) * k) / 2 - bx0 * k
    dy = (H - (by1 - by0) * k) / 2 - by0 * k
    fit = lambda q: (round(q[0] * k + dx, 1), round(q[1] * k + dy, 1))

    out, labels = {}, {}
    for name, rings in raw.items():
        parts = []
        for r in rings:
            pts = [fit(q) for q in r]
            parts.append("M" + "L".join(f"{a},{b}" for a, b in pts) + "Z")
        out[name] = "".join(parts)
        # 라벨은 가장 큰 폴리곤의 무게중심에 둔다
        big = max(rings, key=lambda r: ring_area(r))
        pts = [fit(q) for q in big]
        cx = sum(q[0] for q in pts) / len(pts)
        cy = sum(q[1] for q in pts) / len(pts)
        labels[name] = [round(cx, 1), round(cy, 1)]
        print(f"  {name:<4} 폴리곤 {len(parts):>2}개  라벨 ({cx:.0f},{cy:.0f})  {len(out[name]):>6} chars")

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps({
        "viewBox": f"0 0 {W} {H}",
        "source": "통계청 2018 시도 경계 (southkorea-maps, KOSTAT 원자료) — 단순화 후 SVG 투영",
        "paths": out,
        "labels": labels,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"\n저장: {OUT.name}  {OUT.stat().st_size // 1024} KB  (원본 7.5MB)")


if __name__ == "__main__":
    main()
