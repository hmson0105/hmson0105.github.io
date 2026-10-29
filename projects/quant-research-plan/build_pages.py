#!/usr/bin/env python3
"""files/ 의 마크다운을 읽어 정적 페이지 두 개와 배포용 zip 을 다시 만든다.

    python3 build_pages.py

산출물
    skill/index.html   SKILL.md 본문
    plan/index.html    처음 입력값(01) + 작성 모드 결과(04)
    quant-research-plan-cc.zip

깃허브 페이지(Jekyll)가 거는 제약 두 가지를 피해 간다.
    1. 점으로 시작하는 경로는 배포에서 빠진다 → `.claude/skills/...` 는 404 가 난다.
       저장소에는 `files/SKILL.md` 한 벌만 두고 zip 안에서만 `.claude/` 밑으로 옮긴다.
    2. YAML 프런트매터가 있는 .md 는 정적 파일이 아니라 페이지로 처리되어
       `SKILL.html` 로 바뀐다 → `files/SKILL.md` 주소 자체가 생기지 않는다.
       그래서 원문 링크는 깃허브 blob 주소로 보낸다.
"""

import html
import pathlib
import re
import zipfile

HERE = pathlib.Path(__file__).resolve().parent
FILES = HERE / "files"

# zip 안의 경로 → 저장소 안의 경로
ROOT = "quant-research-plan-cc"
ZIP_LAYOUT = {
    ".claude/skills/quant-research-plan/SKILL.md": "SKILL.md",
    ".claude/skills/quant-research-plan/examples.md": "examples.md",
    "README.md": "README.md",
    "outputs/.gitkeep": "outputs/.gitkeep",
}


# ---------------------------------------------------------------- 마크다운

# 백슬래시로 이스케이프한 문자는 서식 치환 전에 치워 둔다. `\*\* p<.01` 의
# 별표가 굵게 표시의 짝으로 잡히면 문장이 통째로 깨진다.
ESC = {"*": "\x00s\x00", "|": "\x00p\x00", "\\": "\x00b\x00"}


def protect(s):
    for ch, tok in ESC.items():
        s = s.replace("\\" + ch, tok)
    return s


def restore(s):
    for ch, tok in ESC.items():
        s = s.replace(tok, ch)
    return s


def inline(s):
    """인라인 서식. 이스케이프를 먼저 하므로 치환 결과에 태그가 섞이지 않는다."""
    s = html.escape(protect(s))
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    s = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", link, s)
    return restore(s)


def link(m):
    """SKILL.md 가 같은 폴더의 examples.md 를 가리킨다. 한 페이지에 둘 다
    싣고 있으므로 파일 링크가 아니라 페이지 안 앵커로 보낸다."""
    text, href = m.group(1), m.group(2)
    if href == "examples.md":
        href = "#examples"
    ext = ' target="_blank" rel="noopener"' if href.startswith("http") else ""
    return '<a href="%s"%s>%s</a>' % (href, ext, text)


def cells(row):
    r"""`\|` 는 칸 구분자가 아니라 본문의 세로줄이다."""
    row = protect(row).strip().strip("|")
    return [restore(c).strip() for c in row.split("|")]


def render(md, shift=0):
    lines = md.split("\n")
    out, i = [], 0
    n = len(lines)

    while i < n:
        ln = lines[i]
        s = ln.strip()

        if not s:
            i += 1
            continue

        # 코드블록
        if s.startswith("```"):
            i += 1
            buf = []
            while i < n and not lines[i].strip().startswith("```"):
                buf.append(lines[i])
                i += 1
            i += 1
            out.append("<pre><code>%s</code></pre>" % html.escape("\n".join(buf)))
            continue

        # 가로줄
        if re.fullmatch(r"-{3,}|\*{3,}", s):
            out.append("<hr>")
            i += 1
            continue

        # 제목
        m = re.match(r"(#{1,6})\s+(.*)", s)
        if m:
            lv = min(len(m.group(1)) + shift, 6)
            out.append("<h%d>%s</h%d>" % (lv, inline(m.group(2)), lv))
            i += 1
            continue

        # 인용
        if s.startswith(">"):
            buf = []
            while i < n and lines[i].strip().startswith(">"):
                buf.append(re.sub(r"^\s*>\s?", "", lines[i]))
                i += 1
            out.append("<blockquote>%s</blockquote>" % render("\n".join(buf), shift))
            continue

        # 표 — 다음 줄이 구분선일 때만
        if s.startswith("|") and i + 1 < n and re.fullmatch(r"\|[\s:|-]+\|", lines[i + 1].strip()):
            head = cells(lines[i])
            i += 2
            body = []
            while i < n and lines[i].strip().startswith("|"):
                body.append(cells(lines[i]))
                i += 1
            t = ["<div class=\"tscroll\"><table><thead><tr>"]
            t += ["<th>%s</th>" % inline(c) for c in head]
            t.append("</tr></thead><tbody>")
            for r in body:
                r += [""] * (len(head) - len(r))
                t.append("<tr>" + "".join("<td>%s</td>" % inline(c) for c in r[:len(head)]) + "</tr>")
            t.append("</tbody></table></div>")
            out.append("".join(t))
            continue

        # 목록 — 들여쓰기로 중첩
        m = re.match(r"^(\s*)([-*]|\d+\.)\s+(.*)", ln)
        if m:
            block = []
            while i < n:
                mm = re.match(r"^(\s*)([-*]|\d+\.)\s+(.*)", lines[i])
                if mm:
                    block.append((len(mm.group(1)), mm.group(2), mm.group(3)))
                    i += 1
                elif lines[i].strip() and lines[i].startswith(("    ", "\t")):
                    # 항목에 이어지는 줄
                    d, mk, txt = block[-1]
                    block[-1] = (d, mk, txt + " " + lines[i].strip())
                    i += 1
                else:
                    break
            out.append(render_list(block))
            continue

        # 문단
        buf = []
        while i < n and lines[i].strip() and not re.match(
                r"^\s*(#{1,6}\s|>|\||```|[-*]\s|\d+\.\s)|^-{3,}$", lines[i].strip()):
            buf.append(lines[i].strip())
            i += 1
        if not buf:                      # 어느 규칙에도 안 걸린 한 줄
            buf, i = [s], i + 1
        out.append("<p>%s</p>" % inline(" ".join(buf)))

    return "\n".join(out)


def render_list(items, pos=0, depth=None):
    """(들여쓰기, 마커, 내용) 목록을 중첩 <ul>/<ol> 로 바꾼다."""
    if depth is None:
        depth = items[0][0]
    tag = "ol" if items[pos][1][0].isdigit() else "ul"
    out = ["<%s>" % tag]
    while pos < len(items):
        d, mk, txt = items[pos]
        if d < depth:
            break
        if d > depth:
            inner, pos = render_list(items, pos, d), skip(items, pos, d)
            out[-1] = out[-1][:-5] + inner + "</li>"
            continue
        out.append("<li>%s</li>" % inline(txt))
        pos += 1
    out.append("</%s>" % tag)
    return "".join(out)


def skip(items, pos, depth):
    while pos < len(items) and items[pos][0] >= depth:
        pos += 1
    return pos


# ---------------------------------------------------------------- 페이지 틀

def page(title, desc, head, body):
    return f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<meta name="description" content="{desc}">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+KR:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../doc.css">
</head>
<body>
  <header class="site-nav">
    <div class="container nav-inner">
      <a class="nav-back" href="../">← 스킬 개요</a>
      <ul class="nav-links">
        <li><a href="../../../about/">About</a></li>
        <li><a href="../../../research/">Research</a></li>
        <li><a href="../../">Projects</a></li>
        <li><a href="../../../contact/">Contact</a></li>
      </ul>
    </div>
  </header>
  <main>
{head}
    <section class="block container doc">
{body}
    </section>
  </main>
  <footer>
    <div class="container footer-inner">
      <a href="../">← 스킬 개요로</a>
      <span>&copy; 2026 손혜미 (Hyemi Son)</span>
    </div>
  </footer>
</body>
</html>
"""


def main():
    skill_md = (FILES / "SKILL.md").read_text(encoding="utf-8")
    # 프런트매터는 본문이 아니라 메타데이터다. 표로 따로 보여 준다.
    fm = re.match(r"^---\n(.*?)\n---\n", skill_md, re.S)
    meta, skill_body = (fm.group(1), skill_md[fm.end():]) if fm else ("", skill_md)
    meta_rows = "".join(
        "<tr><td><code>%s</code></td><td>%s</td></tr>" % (k, inline(v.strip().strip('"')))
        for k, v in (l.split(":", 1) for l in meta.split("\n") if ":" in l))

    examples_md = (FILES / "examples.md").read_text(encoding="utf-8")

    skill_head = """    <section class="hero container">
      <span class="paper-tag">SKILL.md</span>
      <h1>스킬 본문</h1>
      <p class="lede">클로드 코드가 <code>/quant-research-plan</code> 을 실행할 때 읽는 파일
        전문입니다. 모드 선택·절차·판단 기준·출력 양식 네 부분이고, 끝에 출력 형식을 따로
        안내하는 <code>examples.md</code> 를 함께 실었습니다.</p>
      <div class="dl">
        <a class="ghost" href="https://github.com/hmson0105/hmson0105.github.io/blob/main/projects/quant-research-plan/files/SKILL.md" target="_blank" rel="noopener">깃허브에서 원문 보기</a>
        <a class="ghost" href="../plan/">입력 → 결과 보기</a>
      </div>
    </section>"""

    (HERE / "skill").mkdir(exist_ok=True)
    (HERE / "skill" / "index.html").write_text(page(
        "SKILL.md — 양적연구 계획서 점검 스킬 | 손혜미",
        "quant-research-plan 스킬이 실행 시 읽는 SKILL.md 전문.",
        skill_head,
        '<div class="metatbl"><div class="tscroll"><table><thead><tr><th>필드</th><th>값</th></tr>'
        '</thead><tbody>%s</tbody></table></div></div>\n%s\n'
        '<h2 id="examples">부록 — examples.md</h2>\n%s'
        % (meta_rows, render(skill_body, 1),
           render(re.sub(r"^#\s+.*\n", "", examples_md), 1))),
        encoding="utf-8")

    req = (FILES / "examples" / "01_요청문.md").read_text(encoding="utf-8").strip()
    plan = (FILES / "examples" / "04_실행결과_작성모드.md").read_text(encoding="utf-8")
    plan = re.sub(r"^#\s+연구계획서\s*\n", "", plan)   # 제목은 페이지가 단다

    plan_head = """    <section class="hero container">
      <span class="paper-tag">입력 → 결과</span>
      <h1>요청 한 문단이 계획서가 되기까지</h1>
      <p class="lede">아래 입력을 그대로 주고 작성 모드로 돌린 결과다. 스킬이 개입한
        지점은 세 곳 — 측정되지 않은 변수의 가정을 맨 위에 적고, 횡단면 설계에 맞지 않는
        “영향”을 거두고, 마지막에 규칙 8개로 자기 결과를 점검한다.</p>
      <div class="dl">
        <a class="ghost" href="../skill/">스킬 본문 보기</a>
        <a class="ghost" href="../files/examples/04_%%EC%%8B%%A4%%ED%%96%%89%%EA%%B2%%B0%%EA%%B3%%BC_%%EC%%9E%%91%%EC%%84%%B1%%EB%%AA%%A8%%EB%%93%%9C.md" download>원문 내려받기 (.md)</a>
      </div>
    </section>

    <section class="block container">
      <div class="section-label">Input</div>
      <h2>처음 입력값</h2>
      <blockquote class="req">%s</blockquote>
      <p class="reqnote">변수 네 개와 수집 방식만 있고, 설계에 필요한 나머지는 비어 있다 —
        재택근무를 여부로 볼지 일수로 볼지, 조절이 어느 경로에 걸리는지, 표본을 몇 명
        모을지. 스킬은 이 빈칸을 묻지 않고 <b>가정으로 명시한 뒤</b> 진행한다.</p>
    </section>

    <section class="block container">
      <div class="section-label">Output</div>
      <h2>산출된 연구계획서</h2>
    </section>""" % inline(req)

    (HERE / "plan").mkdir(exist_ok=True)
    (HERE / "plan" / "index.html").write_text(page(
        "입력 → 결과 — 양적연구 계획서 점검 스킬 | 손혜미",
        "요청 한 문단을 입력해 작성 모드로 산출한 양적연구 계획서 전문.",
        plan_head, render(plan)), encoding="utf-8")

    z = HERE / "quant-research-plan-cc.zip"
    with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as zf:
        for inner, src in ZIP_LAYOUT.items():
            zf.write(FILES / src, ROOT + "/" + inner)
        for p in sorted((FILES / "examples").iterdir()):
            zf.write(p, ROOT + "/examples/" + p.name)

    print("skill/index.html, plan/index.html,", z.name,
          "(%d개 항목)" % len(zipfile.ZipFile(z).namelist()))


if __name__ == "__main__":
    main()
