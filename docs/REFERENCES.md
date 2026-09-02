# 참고 문헌 (References)

DeepSims가 설계 근거로 인용한 학술 문헌·정부 보고서의 **출처, 라이선스, 저장소에서의 취급 방침**을 기록한 문서다.

> **방침 (사용자 결정, 2026-09-02): 전문 파일은 저장소에 두지 않고 링크로만 참조한다.**
> 라이선스상 재배포가 가능한 7건도 마찬가지다 — 논문 PDF는 게임 저장소를 무겁게 만들고,
> 어차피 DOI·공식 링크가 영구적이다. 이 문서가 **서지정보·라이선스·적용 지점의 단일 권위**다.
> 아래 표 ①은 "올려도 되는 것" 목록이지 "올린 것" 목록이 아니다 —
> 나중에 발췌·인용이 필요해질 때 무엇이 허용되는지 판단하는 근거로 남긴다.

**원칙: 저작권이 있는 논문 전문(PDF/텍스트)은 이 저장소에 올리지 않는다.**
대신 서지정보 + DOI/공식 링크 + DeepSims에서의 적용 지점만 남긴다. 논지를 설명해야 할 때는 **출처를 밝힌 짧은 인용**이나 **자체 문장으로 재서술한 요약**을 쓴다. 모델·알고리즘·메커니즘 같은 *아이디어* 자체는 저작권 대상이 아니므로 자유롭게 구현하고 설명할 수 있다 — 보호되는 것은 그것을 서술한 *표현*이다.

- 표 ①에 있는 문헌만 전문 파일을 저장소에 둘 수 있다. 각각의 라이선스가 요구하는 저작자 표시를 반드시 함께 넣는다.
- 표 ②의 문헌은 **링크로만** 참조한다. 강의 페이지나 개인 홈페이지에 전문 PDF가 올라와 있더라도, 그것은 관행적 게시이지 우리에게 부여된 재배포 권한이 아니다 — 복사하지 말고 링크만 건다.
- "무료로 읽을 수 있음"과 "재배포해도 됨"은 다른 문제다. 자동 OA 지표(Unpaywall / OpenAlex / Semantic Scholar)는 오탐이 있으므로 단독 근거로 쓰지 않는다(§4 참조).

최종 라이선스 확인: 2026-08-30. 라이선스는 변경될 수 있으므로, 파일을 새로 추가할 때는 각 행의 1차 출처를 다시 확인한다.

---

## 1. 저장소에 전문을 둘 수 있는 문헌 (canRedistribute = true)

| 제목 | 저자 | 연도 | 라이선스 | 링크 | DeepSims 적용 지점 |
|---|---|---|---|---|---|
| Social Infrastructure and the Alleviation of Loneliness in Europe | Christopher S. Swader, Andreea-Valentina Moraru | 2023 | **CC BY 4.0** (© The Author(s)) | [PMC10158682](https://pmc.ncbi.nlm.nih.gov/articles/PMC10158682/) · [DOI 10.1007/s11577-023-00883-6](https://doi.org/10.1007/s11577-023-00883-6) | **#33** 사회적 중력 — 시설 개수가 아니라 동시 체류. 26개 유럽 사회 fsQCA에서 낮은 외로움의 필요조건으로 높은 결사체 참여를 제시 |
| Urban built environment and its impact on university students' loneliness: a mechanistic study | Shuguang Deng, Jinhong Su, Heping Yang, Jinlong Liang, Shuyan Zhu | 2025 | **CC BY 4.0** (Frontiers, 저자 저작권 보유) | [PMC11966460](https://pmc.ncbi.nlm.nih.gov/articles/PMC11966460/) · [DOI 10.3389/fpubh.2025.1514820](https://doi.org/10.3389/fpubh.2025.1514820) | **#33** 외로움과 도시 환경 — 시설 배치(요식·교통·여가·의료·체육 시설 수, 도로망 밀도)와 외로움의 상관. PLAN.md §20.3 "사회적 중력"과 대응 |
| Venues and segregation: A revised Schelling model | Daniel Silver, Ultan Byrne, Patrick Adler | 2021 | **CC BY 4.0** (PLOS ONE) | [PLOS ONE](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0242611) · [DOI 10.1371/journal.pone.0242611](https://doi.org/10.1371/journal.pone.0242611) | **#69** 장소가 관계망을 만든다 — Schelling 모델에 장소(venue) 레이어를 얹으면 분리 양상이 달라짐. 관계 형성을 임의 매칭이 아니라 "누가 어느 장소에 드나드는가"에서 파생시키는 설계 근거 |
| Conceptualizing Public Space Using a Multiple Sorting Task — Exploring the Links between Loneliness and Public Space | Jing Jing, David Canter, Tigran Haas | 2019 | **CC BY 4.0** (MDPI, Gold OA) | [Urban Science 3(4), 107](https://www.mdpi.com/2413-8851/3/4/107) · [DOI 10.3390/urbansci3040107](https://doi.org/10.3390/urbansci3040107) | **#33** 공공 공간과 사회적 상호작용 — 공공 공간의 범주화가 외로움을 기준으로 어떻게 달라지는지. 공간 유형이 접촉·고립 상태에 미치는 영향 로직의 근거 |
| Our Epidemic of Loneliness and Isolation (U.S. Surgeon General's Advisory) | Office of the Surgeon General (HHS), Vivek H. Murthy 명의 | 2023 | **Public Domain** (US Government Work, 17 U.S.C. §105) | [HHS PDF](https://www.hhs.gov/sites/default/files/surgeon-general-social-connection-advisory.pdf) · [NCBI Bookshelf NBK595227](https://www.ncbi.nlm.nih.gov/books/NBK595227/) | 외로움의 사회적 비용 — 사회적 고립의 사망 위험 증가, 심혈관·우울·치매 위험, 사회적 연결 6대 기둥. 외로움 수치가 건강·수명·정신상태에 미치는 영향 모델링의 근거 (코드상 정확한 참조 지점 미확인) |
| Latest Evidence on Induced Travel Demand: An Evidence Review (GOV.UK 게시 제목: *Induced travel demand: an evidence review*) | Dunkerley, Laird, Rohr, Whittaker, Daly (WSP + RAND Europe, DfT 의뢰) | 2018 | **OGL v3.0**, © Crown copyright | [GOV.UK](https://www.gov.uk/government/publications/induced-travel-demand-an-evidence-review) · [PDF 전문](https://assets.publishing.service.gov.uk/media/5c0e5848e5274a0bf3cbe124/latest-evidence-on-induced-travel-demand-an-evidence-review.pdf) | **#48** 유발 수요(induced demand) — 도로 용량 확충이 통행량을 늘리는 효과의 탄력성 추정치와 발생 조건. 인프라 확장 시 통행량 증가 규칙의 파라미터 근거 |
| Social Connections and Loneliness in OECD Countries | OECD (기관 저자) | 2025 | **CC BY 4.0**, © OECD 2025 | [OECD 발간 페이지](https://www.oecd.org/en/publications/social-connections-and-loneliness-in-oecd-countries_6df2d6a0-en.html) · [DOI 10.1787/6df2d6a0-en](https://doi.org/10.1787/6df2d6a0-en) | 외로움 정책 근거 — 사회적 인프라(도서관·공원·커뮤니티 시설)와 디지털 기술을 두 축의 개입 지점으로 제시. 인구집단별 외로움 수치의 캘리브레이션 출처 (코드상 참조 지점 미확인) |
| The KIND Challenge community intervention to reduce loneliness and social isolation | Michelle H. Lim, Alexandra Hennessey, Pamela Qualter, Ben J. Smith, Lily Thurston, Robert Eres, Julianne Holt-Lunstad | 2025 | **CC BY 4.0** (Springer, OA 고지 직접 확인) | [DOI 10.1007/s00127-024-02740-z](https://doi.org/10.1007/s00127-024-02740-z) | **#69** 먼저 돕기 — 3개국 4,284명 RCT에서 '주 1회 작은 친절 행동'이 4주 뒤 외로움을 유의하게 감소(효과는 국가별 상이, 장기 지속 미확인). 시설 방문이 아니라 **자발적 도움 행동**(offer_help)이 외로움을 더는 근거 |
| Interpersonal lending network dataset of a Hungarian village in a disadvantaged region | Márton Gosztonyi, Dániel Havran, Zoltán Pollák, Edina Berlinger | 2023 | **CC BY 4.0** (Elsevier Data in Brief, 본문 고지 확인) | [DOI 10.1016/j.dib.2023.108946](https://doi.org/10.1016/j.dib.2023.108946) | **#57·#76** 관계 기반 소액 차입 — 낙후 지역 마을의 대인 대출망 실측. no_money 불만 415건을 복지 증액이 아니라 **요청·승낙·상환이 있는 차입 행동**(request_loan/lend_money)으로 푸는 근거. 후보 우선순위(가구원→친족→친구→반복 접촉)의 실증 |
| The fiscal response to revenue shocks | Simon Berset, Martin Huber, Mark Schelker | 2023 | **CC BY 4.0** (Springer, © The Author(s) 2022, 출판사 페이지 고지 직접 확인) | [DOI 10.1007/s10797-022-09727-z](https://doi.org/10.1007/s10797-022-09727-z) | **§22.22** 시장 재정 행동 — 취리히 지자체는 수입 충격을 평활화(양의 충격은 이월, 음의 충격은 지출 삭감). '국고 잉여 → 전액 지출'이 아니라 한 걸음씩 반응하는 설계의 실증 근거 |

### 전문을 올릴 때 지켜야 할 것

- **CC BY 4.0 4건** — 저자명·제목·출처(저널/발행처)·DOI·[라이선스 링크](https://creativecommons.org/licenses/by/4.0/)를 함께 표기하고, 원문을 수정·발췌했다면 그 사실을 밝힌다. 재배포 파일은 최종 출판본(Version of Record)을 쓴다.
- **제3자 소재 예외** — CC BY는 논문 안에 인용된 타 출처 도표·사진에는 미치지 않는다. 문서를 원형 그대로 보관하는 것은 괜찮지만, **개별 그림만 떼어 재사용할 때는 그 그림의 크레딧을 따로 확인**한다. OECD 보고서 표지 이미지(© Rawpixel.com/Shutterstock.com)는 명시적으로 CC BY 범위 밖이다.
- **OGL v3.0** — `Contains public sector information licensed under the Open Government Licence v3.0` 문구와 [라이선스 링크](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/)를 함께 둔다.
- **Public Domain(HHS)** — "Unless otherwise noted in the text"라는 단서가 있으므로 본문 내 제3자 저작권 표기가 붙은 도표는 예외다. 출처 표기는 법적 의무가 아니지만 문서가 권장한다.
- **OECD 개작·번역 시** — OECD 로고·비주얼 아이덴티티·표지 이미지 사용 불가, 지정 면책 문구 병기 필요, OECD의 승인·후원을 시사하지 말 것.
- **2차 데이터 주의** — Swader & Moraru는 유럽사회조사(ESS 2014) 2차 분석이다. 논문의 CC BY가 **ESS 원자료 이용약관까지 커버하지 않는다**. 원자료를 받아 저장소에 넣을 계획이면 별도 확인이 필요하다.
- **코드는 별도** — Silver et al.의 모델 코드가 comses.net에 공개되어 있으나, 코드 라이선스는 논문 라이선스와 별개다. 가져다 쓸 계획이면 따로 확인한다.

---

## 2. 링크로만 참조하는 문헌 (canRedistribute = false)

전문 파일을 저장소에 두지 않는다. 서지정보 + 링크 + 자체 문장 요약만 남긴다.

| 제목 | 저자 | 연도 | 라이선스 | 링크 | DeepSims 적용 지점 | 전문을 올릴 수 없는 이유 |
|---|---|---|---|---|---|---|
| Generative Agents: Interactive Simulacra of Human Behavior | Joon Sung Park, Joseph C. O'Brien, Carrie J. Cai, Meredith Ringel Morris, Percy Liang, Michael S. Bernstein | 2023 | ACM 저작권(저자 보유형) — "© 2023 Copyright held by the owner/author(s)". CC 아님 | [DOI 10.1145/3586183.3606763](https://doi.org/10.1145/3586183.3606763) · [arXiv:2304.03442](https://arxiv.org/abs/2304.03442) | **§2.5** 에이전트 인지 아키텍처 — 기억 스트림 / 회고 / 계획. 최신성·중요도·관련성 3요소 검색 점수화, 관찰로부터 상위 수준 회고 합성, 계획의 재귀적 분해 구조를 결정적 심즈라이크 로직으로 차용·변형 | 논문 1쪽 각주가 무료 복제를 **"개인적 또는 강의실 용도"의 비영리 복제**로 한정하고 그 외 모든 용도는 저자 연락을 요구한다. 공개 저장소 게시는 그 범위 밖. arXiv 판본도 CC가 아니라 arXiv 비독점 라이선스라 제3자 재배포 권한이 없다 |
| Threshold Models of Collective Behavior | Mark S. Granovetter | 1978 | All rights reserved — "Copyright 1978 The University of Chicago" | [DOI 10.1086/226707](https://doi.org/10.1086/226707) | **§19.5** 시민 불만 → 집단 청원 — 시민마다 개별 임계값을 부여하고, 임계값 빈도분포로부터 균형 참여 규모를 결정론적으로 계산. "평균이 같아도 분포가 다르면 결과가 정반대"라는 논지가 집계값에서 개인 성향을 역추론하지 않는 설계 근거 | 구독 기반 페이월(개별 구매 $17), 오픈 라이선스 표기 전무, DOAJ 미등재. 출판사 자기보관 예외는 저자에게만 적용되며 우리는 저자가 아니다. **자동 OA 지표가 CC BY로 오탐하므로 §4 경고를 반드시 볼 것** |
| Dynamic models of segregation | Thomas C. Schelling | 1971 | All rights reserved (© Informa UK / Taylor & Francis) | [DOI 10.1080/0022250X.1971.9989794](https://doi.org/10.1080/0022250X.1971.9989794) | **#69** 관계 형성 — 국소 선택이 도시 패턴을 만든다. 이웃 구성에 대한 온건한 개별 선호와 국소 만족 임계값만으로 전역적 분리/군집이 창발 (tipping 분석 포함) | 구독 기반 하이브리드 저널이며 OA로 전환된 적 없음(Unpaywall `oa_status=closed`, OA 사본 0건, Crossref license 필드 부재). 전문은 유료 구매 뒤에 있고 재사용은 RightsLink 개별 허락 절차를 요구한다. 대안으로 검토한 RAND 전신 보고서(RM-6014-RC, 1969)도 온라인 재게시를 명시적으로 금지한다 |
| The Fundamental Law of Road Congestion: Evidence from US Cities | Gilles Duranton, Matthew A. Turner | 2011 | All rights reserved (© American Economic Association) | [AEA 아티클](https://www.aeaweb.org/articles?id=10.1257/aer.101.6.2616) · [DOI 10.1257/aer.101.6.2616](https://doi.org/10.1257/aer.101.6.2616) | **#48** 교통 유발 수요 — 차선 확장이 VKT를 거의 비례적으로 늘려 혼잡이 해소되지 않는다는 실증. 용량 증설 후 혼잡도가 원래 수준으로 회귀하는 규칙의 출처 | AEA 저작권 정책이 **개인·강의용 복제만** 무료 허용하고 배포는 명시적으로 배제. 선행 NBER 워킹페이퍼(w15376)도 "All Rights Reserved". 저자 개인 사이트의 자가보관본은 그 사이트에 대한 허용일 뿐 제3자 재배포 권한이 아니다 |
| Cumulative effects of triadic closure and homophily in social networks | Aili Asikainen, Gerardo Iñiguez, Javier Ureña-Carrión, Kimmo Kaski, Mikko Kivelä | 2020 | **CC BY-NC 4.0** (Science Advances) | [DOI 10.1126/sciadv.aax7310](https://doi.org/10.1126/sciadv.aax7310) · [PMC7209984](https://pmc.ncbi.nlm.nih.gov/articles/PMC7209984/) | **§17.18** 삼각 폐쇄 — "친구의 친구와 빨리 가까워진다". 삼각 폐쇄와 선택적 동종선호의 동적 상호작용이 유도 동종선호를 낳고 누적되면 코어-주변부 구조로 이어짐. 공통 친구가 있는 NPC 쌍의 관계 형성 확률을 높이는 규칙의 근거 | 라이선스는 확실히 CC BY-NC 4.0이지만 **NC(비상업) 조건** 때문에 보류한다. 이 저장소는 이력서·포트폴리오 성격이라 상업적 맥락으로 해석될 여지가 있고, 그 경우 라이선스 위반이 된다. 용도가 명백히 비상업적임이 확정되면 저작자·출처·라이선스 고지와 함께 전문 포함이 가능하다. arXiv 프리프린트(1809.06057)는 대안이 못 된다(arXiv 비독점 라이선스) |
| A Long-Run Model of Housing Affordability | Geoffrey Meen | 2011 | All rights reserved (© Taylor & Francis) | [DOI 10.1080/02673037.2011.609327](https://doi.org/10.1080/02673037.2011.609327) · [CentAUR 수락본 레코드](https://centaur.reading.ac.uk/24470/) | **#47 / #51** 가구 형성 · 주거 · 노동시장 — 주택가격·가구 형성·점유형태·지역 간 이주·인구구조·노동시장을 하나의 장기 모형으로 연결. 주택 공급/가격이 가구 분화와 이주·노동 공급으로 되먹임되는 장기 동학이 파라미터·인과 구조의 근거 | 구독 기반 폐쇄형 저널(OpenAlex `oa_status=closed`, license=null; Crossref license 필드 부재). 무료로 받을 수 있는 CentAUR 저자수락본도 대안이 아니다 — "Available under license" 필드가 비어 있고, 리포지터리 이용약관이 **개인 연구·학습·교육 목적의 단일 복제**만 허용하며 그 외 배포·공표는 서면 허락을 요구한다 |
| A place-focused model for social networks in cities | Chloë Brown, Anastasios Noulas, Cecilia Mascolo, Vincent Blondel | 2013 | arXiv 비독점 라이선스(nonexclusive-distrib/1.0). 출판본은 © IEEE | [arXiv:1308.2565](https://arxiv.org/abs/1308.2565) · [DOI 10.1109/SocialCom.2013.18](https://doi.org/10.1109/SocialCom.2013.18) | 로드맵의 "'사람이 있는 장소'로 바꾸는 사회적 중력" 항목 근거 (로드맵 원문 표기는 **#33 확장(P2)**, 과제 힌트는 #69 — 이슈 재번호 가능성, 미확인). 장소가 사회적 유대의 focus로 작동한다는 focused organization theory를 근거로, 장소별 시간대·활동 태그·혼잡도로 심을 결정적으로 매칭 | arXiv 기본 라이선스는 저자가 **arXiv에게만** 배포 권한을 준 것이고 제3자 재배포 조항이 없다. CC 계열이 아니다. 정식 출판본은 IEEE 논문집으로 IEEE가 저작권을 보유하며 Crossref에 오픈 라이선스 표기가 없다 |
| The Behavior of U.S. Public Debt and Deficits | Henning Bohn | 1998 | All rights reserved (QJE © 1998 OUP — JSTOR 권리 표기 직접 확인) | [DOI 10.1162/003355398555793](https://doi.org/10.1162/003355398555793) · [JSTOR 2586878](https://www.jstor.org/stable/2586878) | **§22.22** 재정 반응 함수 — 1차 흑자가 부채비율의 증가함수(교정 행동). 국고 편차에 오차수정형으로 반응하는 시장 규칙의 이론 근거. '흑자 축적→완화' 방향은 대칭 확장(모델링 선택) | 구독 저널. OUP 페이지는 봇 차단이라 JSTOR 권리 표기로 판정 (§4.2) |
| The Political Business Cycle | William D. Nordhaus | 1975 | All rights reserved (RES © 1975 — JSTOR 권리 표기 직접 확인) | [DOI 10.2307/2296528](https://doi.org/10.2307/2296528) | **§22.22** 정치적 순환 — 회고·근시안 투표 하에서 재선 극대화 재임자는 선거 전 완화·선거 후 긴축. 유세 시작일 리뷰 발화의 근거 | 구독 저널(OUP 봇 차단 — JSTOR 판정, §4.2) |
| Equilibrium Political Budget Cycles | Kenneth Rogoff | 1990 | All rights reserved (AER © 1990 AEA; 개인·강의용 비배포 복제만 무료) | [JSTOR 2006731](https://www.jstor.org/stable/2006731) · [NBER w2428](https://doi.org/10.3386/w2428) | **§22.22** 균형 예산 순환 — 재임자가 능력 신호를 위해 선거 전 '보이는' 이전지출·감세로 편향. 완화를 복지·감세에 집중하는 설계 근거 | AEA 저작권 (Duranton & Turner 행과 동일 사유). 1990 AER은 DOI 미등록 — JSTOR 스테이블 링크 |
| An Economic Theory of Democracy | Anthony Downs | 1957 | All rights reserved (상업 단행본, Harper 1957; 판권면 verbatim 미열람) | [IA 서지](https://archive.org/details/economictheoryof0000down) · [JPE 축약판 DOI 10.1086/257897](https://doi.org/10.1086/257897) | **§22.20·§22.22** 관직 추구 공리 — 정당은 집권하려고 정책을 만들고 유권자는 효용 비교로 투표. 시장 목적함수를 재선으로 두는 설계의 공리 | 1957년 저작권 존속, IA 사본도 대출 제한. JPE 축약판도 폐쇄형 |
| The Dynamic Response of Municipal Budgets to Revenue Shocks | Ines Helm, Jan Stuhler | 2024 | All rights reserved (AEA 페이지 직접 확인) | [DOI 10.1257/app.20220718](https://doi.org/10.1257/app.20220718) | **§22.22** 지자체 조정 동학 — 지출은 충격에 수년 내 적응, 세율은 10년 이상 최후순위. 긴축 시 지출 먼저·세율 나중 순서의 실증 근거 | AEA 구독 저널. IZA·SSRN 워킹페이퍼 판본은 VoR 아님·재배포 권한 없음 |
| Food and financial coping strategies during the monthly SNAP cycle | Eliza W. Kinsey, Megan M. Oberle, Roxanne Dupuis | 2019 | **CC BY-NC-ND 4.0** (Elsevier SSM–Population Health) | [DOI 10.1016/j.ssmph.2019.100393](https://doi.org/10.1016/j.ssmph.2019.100393) | **#76** 월중 식량 관리 — 지원 지급 주기에 맞춰 소비를 조절하는 대처 행동(저가 대체 구매·비축)의 실증. stock_food/plan_food_budget 행동의 근거 | **NC(비상업)+ND** 조건 — 이 저장소는 포트폴리오 성격이라 상업적 맥락으로 해석될 여지가 있어 삼각 폐쇄 논문(§2 CC BY-NC)과 같은 사유로 링크만 둔다 |

---

## 3. 게임 자료 주의

Anno 1800, Civilization 시리즈, Cities: Skylines 같은 **상용 게임의 공식 페이지·위키·매뉴얼은 설계 방향의 참고일 뿐이며, 이 문서의 라이선스 조사 대상이 아니다.** 이들 자료는 퍼블리셔가 저작권을 보유한 마케팅·문서 자료이므로 다음을 지킨다.

- **인용만 하고 복제하지 않는다.** 스크린샷, 아트워크, 매뉴얼 페이지, 위키 본문, 트레일러 캡처, UI 이미지를 저장소에 넣지 않는다. 공식 페이지 URL과 게임명·개발사·출시연도만 남긴다.
- 팬 위키(Fandom 등)는 CC BY-SA 계열일 수 있으나 **문서마다 다르고 게임사 자산이 섞여 있다**. 확인 전에는 링크만 건다.
- **게임 시스템·규칙·메커니즘 자체(아이디어)는 저작권 대상이 아니다.** "체인 생산 구조", "행복도 페널티", "구역 지정과 수요 곡선" 같은 메커니즘은 자유롭게 구현하고 설명할 수 있다. 보호되는 것은 그 메커니즘을 서술한 텍스트·수치표·이미지 같은 *표현*이므로, DeepSims 문서에는 반드시 **자체 문장으로 재서술한 설명**만 둔다.
- 상표(게임명·로고)는 식별 목적의 언급에 한해 쓰고, 해당 퍼블리셔와의 제휴·승인을 시사하지 않는다.

---

## 4. 확인하지 못한 것

라이선스를 **끝내 판정하지 못한(= "확인 불가") 문헌은 없다.** 위 14건은 모두 1차 출처 또는 출판사가 기탁한 메타데이터로 라이선스를 확정했다. 다만 아래는 확인 과정의 한계이거나 아직 미해결인 항목이므로, 확실한 것처럼 쓰지 않는다.

### 4.1 자동 OA 지표 오탐 — 반드시 유지할 경고

**Granovetter (1978), DOI 10.1086/226707** 에 대해 Unpaywall · OpenAlex · Semantic Scholar **세 곳 모두** `is_oa=true`, `oa_status="green"`, `license="cc-by"`(출처 `hal.science/hal-05321562`)를 반환한다. 이는 **오탐이다.** HAL API로 직접 조회한 결과 hal-05321562는 Granovetter 논문이 아니라 Aurélien Delage & Christine Solnon의 2025년 ROADEF 발표논문이며, 그 레코드에 DOI가 **잘못 입력**되어 있다. 붙어 있는 CC BY 4.0은 그 프랑스 논문의 것이지 Granovetter 논문과 무관하다. **후속 파이프라인이 이 플래그를 보고 재배포 가능으로 오판하지 않도록 이 문단을 삭제하지 말 것.**

일반화하면: aggregator의 OA 플래그는 단독 근거가 아니다. `oa_status="gold"`(예: Generative Agents)도 "출판사 사이트에서 무료로 읽힌다"는 뜻일 뿐 `license=null`이면 재배포 허용이 아니다.

### 4.2 봇 차단으로 1차 출처를 육안 확인하지 못한 항목

아래 사이트들이 HTTP 403(Cloudflare / Anubis 등)으로 자동 접근을 막아, 출판사 페이지의 저작권 문구를 직접 읽지 못했다. **판정 자체는 대체 1차 출처로 확정했으나, 출판사 원문 문구의 verbatim 인용은 하지 않는다.**

| 문헌 | 막힌 곳 | 판정에 쓴 대체 근거 |
|---|---|---|
| Generative Agents | [ACM DL 페이지](https://dl.acm.org/doi/10.1145/3586183.3606763) | arXiv v2 캐머라레디 PDF 1쪽 저작권 각주 직접 추출 + Crossref + OpenAlex 3중 확인 |
| Granovetter 1978 | journals.uchicago.edu, hal.science, jstor.org | 브라우저로 출판사 페이지를 직접 열어 "Copyright 1978 The University of Chicago" 확인 |
| Schelling 1971 | tandfonline.com, rand.org | 브라우저로 출판사 페이지 직접 확인 + Unpaywall `closed` + Crossref license 부재 |
| Meen 2011 | [tandfonline 논문 페이지](https://www.tandfonline.com/doi/full/10.1080/02673037.2011.609327) | Crossref(license 필드 부재) + OpenAlex(`closed`) + CentAUR 레코드 및 End User Agreement |
| Asikainen et al. 2020 | science.org | [PMC 저작권 표기](https://pmc.ncbi.nlm.nih.gov/articles/PMC7209984/)에서 CC BY-NC 확인 |
| Jing, Canter & Haas 2019 | [MDPI 페이지](https://www.mdpi.com/2413-8851/3/4/107) (HTML·PDF 모두) | 출판사가 기탁한 Crossref license 레코드(CC BY 4.0, VoR) + Unpaywall(`gold`, cc-by) + OpenAlex 3중 확인 |
| Brown et al. 2013 | ieeexplore.ieee.org | arXiv abs 페이지 라이선스 블록 + Crossref(publisher=IEEE, license=null) |
| Surgeon General Advisory | hhs.gov PDF 직접 접근 | [NCBI Bookshelf 전문 재수록본](https://www.ncbi.nlm.nih.gov/books/NBK595227/)의 퍼블릭 도메인 고지 |
| Induced travel demand (DfT) | rand.org의 RAND Europe external publication 페이지 | 발행 주체인 DfT의 GOV.UK 공식 게시본 푸터 OGL v3.0 표기 + PDF 전문 권리 유보 문구 전수 검색(없음) |

### 4.3 서지정보 중 미확인 필드

- **Swader & Moraru (2023)** — 권/호/페이지 번호 미확인(Europe PMC가 `1-28`로만 표기). 정식 인용문 작성 시 보완 필요.
- **Induced travel demand (2018)** — 보고서에 정식 저자 바이라인이 없다. 표기한 5인은 PDF 내부 Quality Control 표의 Prepared/Checked/Authorised 항목에서 읽은 것이라 **저자 순서·역할이 불확실**하다. GOV.UK 페이지에는 발행 기관만 표기된다.
- **제목 이중 표기** — DfT 보고서는 GOV.UK 제목(*Induced travel demand: an evidence review*)과 PDF 표지 제목(*Latest Evidence on Induced Travel Demand: An Evidence Review*)이 다르므로 인용 시 병기한다.
- **Generative Agents** — ACM 판본의 저자 표기는 "Joseph O'Brien", "Carrie Jun Cai"로 arXiv 판본과 미세하게 다르다.
- **Jing, Canter & Haas** — 과제에 주어졌던 URL의 ISSN(`2413-8521`)은 존재하지 않는 값이다. Urban Science의 실제 e-ISSN은 `2413-8851`이며 표 ①의 링크가 정확한 URL이다.

### 4.4 DeepSims 적용 지점이 미확인인 항목

아래는 **저장소 코드/문서를 직접 대조하지 않았거나, 대조했으나 인용 흔적을 찾지 못한** 항목이다. 표에 적힌 적용 지점은 오케스트레이터가 제공한 용도 기술과 문헌 내용의 정합성에 근거한 것이며, 확증된 매핑이 아니다.

- **Surgeon General Advisory**, **OECD Social Connections** — 어느 계산식·파라미터의 근거인지 코드로 확인하지 못함.
- **Deng et al. (2025)** — DeepSims 코드베이스를 grep한 결과 PMCID·DOI·식별자가 로그 외 어디에도 없어 **코드상 직접 연결은 미상**. PLAN.md §20.3과 내용상 대응할 개연성만 확인.
- **Brown et al. (2013)** — 로드맵 문서(`logs/roadmap-20260902-0922.md`)에는 **#33 확장(P2)**으로 표기되어 있어 과제 힌트(#69)와 이슈 번호가 다르다. 후속 재번호 가능성이 있으나 미확인.
- **Granovetter, Duranton & Turner, Meen, Asikainen** — 이론적 출처는 명확하나 구체적 파라미터 매핑은 코드 미대조.

이들 문헌은 모두 표 ①/②의 방침에 따라 취급하되, **적용 지점 서술은 "…로 보인다" 수준의 추정임을 유지**한다.

### 4.5 후속 확인 과제

- **Granovetter의 오픈액세스 후속 논문** — *Threshold Models of Collective Behavior II*, Sociological Science, vol. 7 (2020), pp. 628–648. Sociological Science는 OA 저널이므로 재배포 가능한 대체 문헌이 될 가능성이 있다. **이번 조사 범위 밖이라 라이선스 미검증** — 저장소에 넣기 전 별도 확인 필요.
- **Asikainen et al.**의 NC 조건 — 이 저장소의 성격(비상업 여부)을 확정하면 표 ①로 옮길 수 있다.
