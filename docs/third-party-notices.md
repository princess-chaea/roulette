# 외부 엔진·폰트·브랜드 자산 고지

## MediaPipe

`@mediapipe/tasks-vision` 1.2.2 및 Lite Pose Landmarker 모델. Apache License 2.0 고지는 `assets/vendor/mediapipe/LICENSE`에 동봉했다. 다운로드 주소와 파일 SHA-256은 같은 폴더의 manifest.json에 기록한다. 원본 배포 파일은 수정하지 않았다.

- [공식 Web 가이드](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker?tab=Web)
- [공식 패키지](https://www.npmjs.com/package/@mediapipe/tasks-vision)
- [고정 모델](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task)
- [카메라 보안 컨텍스트](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)

엔진·모델·WASM은 앱에 자체 호스팅한다. 앱은 사용자 영상을 녹화하거나 업로드하지 않는다. 카메라는 사용자 권한과 HTTPS/localhost 환경이 필요하다.

## 폰트

사용자가 제공한 ZIP에서 학교안심 포스터 B, 케리스 배움체 R/B TTF를 변경 없이 복사했다. 저작권 KERIS, 제작 Together Group. SIL Open Font License 1.1 전문과 저작권 고지는 `assets/fonts/OFL.txt`에 동봉한다. 공식 페이지에서 웹·UI·임베딩 사용 및 재배포 허용을 확인했다.

- [학교안심 포스터 공식 페이지](https://copyright.keris.or.kr/wft/fntDwnldView?fntGrpId=GFT202510270000000000001)
- [케리스 배움체 공식 페이지](https://copyright.keris.or.kr/wft/fntDwnldView?fntGrpId=GFT202512150000000000001)
- [SIL OFL 공식 전문](https://openfontlicense.org/open-font-license-official-text/)

## 연구회 로고

사용자가 제공한 초등정보교과교육연구회 부스시안 PDF의 1쪽 첫 번째 A안에서 원본 가로 로고를 추출했다. 단체명은 초등정보교과교육연구회, 영문은 GYEONGBUK ELEMENTARY INFORMATICS. 파일은 `assets/brand/research-group-a.png`다. 원본 PDF 전체는 저장소에 포함하지 않는다. 별도의 공개 재사용 라이선스를 부여하는 고지는 아니다.

## 생성 이미지

내장 ImageGen으로 새로 생성한 동작 안내 2종과 룰렛 로고 1종은 `assets/art/`에 저장했다. 프롬프트와 생성 기록은 [image-prompts.md](image-prompts.md)에 있다.

추가 생성 자산: 시작 자세 3종과 등수별 표정 10종. 프롬프트는 starter-art-prompts.md, starter-heart-art-prompt.md, rank-art-prompts-01-05.md, rank-art-prompts-06-10.md에 기록했다. 연구회 로고는 원본을 보존하고 화면의 알파 필터로 밝은 배경만 제거한다.
