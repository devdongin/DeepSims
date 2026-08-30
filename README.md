# DeepSims

2D 쿼터뷰(아이소메트릭) 심즈라이크 라이프 시뮬레이션. **접속하지 않아도 세계가 계속 흘러갑니다** —
24시간 서버가 아니라 *결정적 따라잡기 시뮬레이션*(시간의 지연 평가)으로, 다시 접속하면 그동안
심들이 살아온 이야기를 부재중 리포트로 받아봅니다.

![DeepSims 목업](docs/mockup.png)
*(목업 이미지 — 실제 게임 화면은 개발 중)*

## 특징

- **오프라인 세계 진행**: 서버가 꺼져 있던 시간만큼 접속 시 빨리감기로 따라잡기. 같은 시드 + 같은
  입력이면 언제 어떻게 나눠 실행해도 결과가 완전히 동일한 결정적 시뮬레이션.
- **논문 기반 에이전트 인지**: Stanford *Generative Agents*(Smallville)의 기억 스트림·회고·하루 계획·
  정보 확산 아키텍처를 LLM 없이 정수 규칙 연산으로 이식. 심들은 성격(Big Five)·기분·관계·습관에
  따라 스스로 판단합니다.
- **전부 로컬**: Node 서버 + SQLite 파일 + 브라우저 클라이언트. 외부 서비스·API 키 불필요.
- 도트그래픽 아트 (Codex imagegen 생성).

## 설치 및 실행

요구사항: Node.js ≥ 20, npm

```bash
git clone https://github.com/devdongin/DeepSims.git
cd DeepSims
npm install
npm start
```

브라우저에서 `http://localhost:3000` 접속.

서버를 종료해도 세계는 "흘러갑니다" — 다시 `npm start` 하면 그동안의 시간을 따라잡고,
접속 시 부재중 리포트를 보여줍니다. 모든 데이터는 로컬 `deepsims.db` 파일 하나에 저장됩니다.

**초기화**: 세계를 처음부터 다시 시작하려면 서버를 끄고 `deepsims.db*` 파일을 삭제하세요.
**다른 시드**: `DEEPSIMS_SEED=12345 npm start`
**손상 복구**: 부팅 시 손상이 감지되면 서버가 안내 메시지와 함께 정지합니다. `deepsims.db`의
`snapshot` 테이블에서 id=2(직전 체크포인트)의 값을 id=1로 복사하고 `meta.lastSimulatedTick`을
그 틱으로 맞춘 뒤 재시작하세요.

## 프로젝트 상태

- [x] 기획서 (Claude ↔ Codex 교차 검증 5회, [PLAN.md](PLAN.md))
- [x] Phase 1: 결정적 코어 루프 (욕구·유틸리티 AI·예약·따라잡기·영속화·클라이언트, 테스트 31개)
- [ ] Phase 2: 특성(성별·나이·MBTI·직업)·기분 + 플레이어 온보딩(내 배경 입력 → 내 심 생성)
- [ ] Phase 3: 기억 스트림·회고
- [ ] Phase 4: 하루 계획·정보 확산 (파티 확산 실험 재현) + 행동 종류 확장
- [ ] 도트 에셋 통합

## 특이사항 제보 → 로직 진화

심이 이상하게 행동하나요? 시뮬레이션이 결정적이라 **시드 + 게임 시각만 있으면 완전 재현**됩니다.
[특이사항 이슈](../../issues/new?template=anomaly.md)로 올려주시면 LLM 교차 리뷰(Claude 설계 ↔
Codex 검증)를 거쳐 판단 로직이 지속적으로 개선됩니다. 규칙 개선 아이디어는
[로직 개선 제안](../../issues/new?template=logic-proposal.md)으로.

## 개발 방식

Claude Code(설계·구현)와 OpenAI Codex(검증·리뷰·이미지 생성)의 듀얼 AI 루프로 개발합니다.
기획서는 두 AI의 교차 리뷰로 합의된 버전만 반영됩니다 (`docs/` 및 codex_review_*.md 참조).

## 라이선스

MIT
