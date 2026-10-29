# quant-research-plan — Claude Code용 패키지

양적연구 계획서를 22개 구성요소로 **작성**하거나, 기존 초안의 요소 간 정합성을 **점검**하는 Claude Code 스킬입니다.

## 폴더 구성

```
quant-research-plan-cc/
├── README.md                          ← 이 파일
├── .claude/skills/quant-research-plan/
│   ├── SKILL.md                       ← 스킬 본체 (절차·판단 기준·출력 양식)
│   └── examples.md                    ← 출력 형식 안내 (필요할 때만 읽힘)
├── examples/
│   ├── 01_요청문.md                   ← 작성 모드 예시 입력
│   ├── 02_스킬미적용_초안.md          ← 점검 모드 예시 입력 (스킬 없이 생성한 초안)
│   ├── 03_실행결과_점검모드.md        ← 02를 점검한 결과
│   ├── 04_실행결과_작성모드.md        ← 01을 작성한 결과
│   └── 05_ClaudeCode_점검모드_실행결과.md ← 이 패키지를 Claude Code에서 실제로 돌린 결과
└── outputs/                           ← 새 실행 결과가 저장되는 곳
```

## 1. 준비

Claude Code가 설치되어 있어야 합니다. 설치 방법: https://code.claude.com/docs/en/overview

## 2. 이 폴더에서 바로 쓰기 (프로젝트 스킬)

```bash
cd quant-research-plan-cc
claude
```

Claude Code 안에서 다음처럼 입력합니다.

**점검 모드** — 초안 파일 경로를 줍니다.

```
/quant-research-plan examples/02_스킬미적용_초안.md
```

**작성 모드** — 주제·변수·데이터를 설명합니다.

```
/quant-research-plan 재택근무 강도와 직무만족의 관계, 직무자율성 매개, 조직지원인식 조절, 직장인 온라인 설문
```

`/` 없이 "이 연구계획서 점검해줘"처럼 말해도 설명이 맞으면 스킬이 자동으로 불립니다. 결과는 `outputs/` 폴더에 저장됩니다.

내 초안을 점검하려면 초안을 `.md` 또는 `.txt`로 이 폴더에 넣고 그 경로를 주면 됩니다.

## 3. 모든 프로젝트에서 쓰기 (개인 스킬)

스킬 폴더를 홈 디렉터리로 복사합니다.

```bash
# macOS / Linux
mkdir -p ~/.claude/skills
cp -r .claude/skills/quant-research-plan ~/.claude/skills/
```

```powershell
# Windows PowerShell
New-Item -ItemType Directory -Force "$HOME\.claude\skills" | Out-Null
Copy-Item -Recurse .claude\skills\quant-research-plan "$HOME\.claude\skills\"
```

이후 어느 폴더에서 `claude`를 실행해도 `/quant-research-plan`을 쓸 수 있습니다.

## 4. 대화 없이 한 번에 실행 (선택)

```bash
claude -p "/quant-research-plan examples/02_스킬미적용_초안.md" --allowedTools "Read" "Write" "Glob" "Grep" "Skill"
```

질문할 사람이 없으므로 스킬은 필요한 가정을 결과 맨 위에 적고 진행합니다.

## 5. 적용 전후 비교를 다시 해 보려면

1. 스킬이 **없는** 빈 폴더에서 `claude`를 실행하고 `examples/01_요청문.md`의 내용을 그대로 붙여 넣습니다. 이것이 "적용 전" 초안입니다.
2. 그 초안을 이 폴더에 저장한 뒤 `/quant-research-plan <파일 경로>`로 점검합니다.
3. 같은 요청문으로 `/quant-research-plan`을 실행해 "적용 후" 초안을 얻습니다.

개인 스킬(3번)로 설치했다면 1단계에서는 스킬이 자동으로 불릴 수 있습니다. 이때는 "스킬을 쓰지 말고 작성해줘"라고 덧붙이세요.

## 참고

- 가상결과의 수치는 모두 예시입니다.
- 확인되지 않은 통계·문헌은 `[저자, 연도]` 같은 자리표시로 남습니다. 직접 확인해 채워야 합니다.
- 규칙 8개 밖의 오류(예: 표본 수 근거의 세부 계산)는 걸러지지 않을 수 있습니다.
- 같은 초안이라도 실행할 때마다 "보완"과 "충족" 경계의 판정은 조금 달라질 수 있습니다. 예시 03과 05는 같은 초안을 두 번 점검한 결과로, "위반" 3건(규칙 1·7·8)은 같았고 규칙 2의 판정만 보완과 충족으로 갈렸습니다.
