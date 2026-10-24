# Prestandaprov v0.4 – 2026-10-24

Miljö: Raspberry Pi 5 / pinode2, arm64, Node v22.22.2. Webbläsarprov med systemets Chromium i headless-läge och **SwiftShader/mjukvaru-WebGL**, två renderingar på 640 × 480. Dessa resultat är inte en garanti för spelarnas GPU:er eller mobiltelefoner.

## Fysik utan rendering

`npm run benchmark:physics`: två borgar, 354 block, 588 strukturförbindelser. 120 steg för intakt struktur, därefter tungt skott och 600 steg. Trälådor/partiklar ingår inte i just detta prov.

| Belastning | Median ms/steg | p95 ms/steg | Max ms/steg |
|---|---:|---:|---:|
| Intakta borgar | 0.71 | 1.06 | 7.80 |
| Skott och ras | 0.67 | 3.12 | 16.42 |

Rasprovet lossade 13 block och bröt 29 förbindelser. Högst 13 block var aktiva samtidigt; vid slutet sov 13 och 0 var aktiva. Ingen tid förkastades i det manuellt stegrade fysikprovet.

## Full webbläsare

Hostprov med verkliga modeller, två kameror, ett tungt skott, ras och två lokala träbränder. Den andra mätpunkten tas efter cirka två sekunder med 20 000 kosmetiska fragment. Täthet i damm/moln och JIT/GPU-cache ger variation mellan körningar.

| Läge | Senaste FPS-fönster | Renderanrop median/p95 ms | Fysiksteg median/p95 ms | Kosmetiska fragment |
|---|---:|---:|---:|---:|
| Normal scen efter ras | 15.3 | 2.50 / 10.70 | 1.20 / 3.60 | 47 |
| Stress | 2.6 | 2.20 / 7.10 | 1.20 / 3.40 | 20000 |

Renderanrop mäter CPU-tiden kring två renderer.render, inte väntan tills GPU:n är färdig. Därför kan låga renderanropstider samexistera med låg faktisk FPS i mjukvaru-WebGL. Median/p95 kommer från upp till 180 senaste bildrutor och stressfönstret kan innehålla tidigare normalbilder; FPS är en kort mätpunkt, inte ett långt benchmarkmedelvärde.

Fullscenen innehåller 356 block inklusive trälådor. Efter skottet hade 10 lossnat, 2 flyttats mer än 0,3 och 2 fallit mer än 0,3. Slutligen sov 8 lossnade kroppar. Stressknappen skapade inga fler rigidbodies.

Fragmenten förenklades från 20 till 4 trianglar per instans (tetraedrar). Poolerna har fasta tak: 2400 effektpartiklar och 20 000 kosmetiska splitter. Murblock renderas instanserat; sleeping och max sex fysiksteg per bild begränsar kostnaden. Vid långa shaderkompileringar, bakgrundspauser eller för låg FPS förkastas överskjutande tid; diagnostiken visar detta i stället för att dölja nedväxlingen.

**Kvar att mäta:** faktisk GPU-rendering på spelarnas datorer, fysiska telefoner/Safari, längre serier med upprepade stora ras och WebRTC över två externa nät. Stressläget är avsiktligt en belastningsdiagnostik och utlovas inte vara spelbart på alla klienter. Inget av dessa prov förutsätter att Pi:n renderar eller simulerar åt riktiga spelare; i drift sker arbetet i hostens webbläsare.

Råa sammanfattningar finns i [performance-v0.4.json](performance-v0.4.json). Reproducera med `npm run benchmark:physics` och `npm run test:e2e -- --grep 'v0.4 host'`.
