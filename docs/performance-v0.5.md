# Prestanda v0.5 – 2026-10-26

Pi 5 / pinode2, arm64, Node v22.22.2. Fysikprovet kördes separat efter att browserprovet avslutats. Browserprovet använder Chromium **SwiftShader/mjukvaru-WebGL**, två separata sessionskontexter och verklig video-/audio-RTP. Detta motsvarar inte en spelardators GPU.

## Fysik utan rendering

`npm run benchmark:characters` bygger två borgar (354 murblock, 588 stödrelationer), två dynamiska kapslar, kanonproxies och egna spelplansgränser. Det tar 120 intakta steg, skjuter tung ammunition och tar ytterligare 600 steg. Trälådor, 3D-modeller och WebAudio ingår inte i detta avgränsade prov.

| Läge | Median ms/steg | p95 ms/steg | Max ms/steg |
|---|---:|---:|---:|
| Intakta borgar + två kapslar | 1.58 | 3.23 | 16.32 |
| Skott och ras + två kapslar | 1.03 | 3.44 | 18.45 |

13 murblock lossnade; högst 13 murblock var aktiva samtidigt och 13 sov vid slutet. Kapslarna räknas separat från murstatistiken och är inte sovande murfragment. En liten skyddsdämpad explosionsskada registrerades på den närmaste spelaren. Fysikstegen är fasta 1/60 s, med samma tidsbudget som v0.4.

## Browser och transport

Det sammanhängande tvåsessionsprovet kör gång, musstyrning, bemanning, skott, båda röstvägarna med testton, faktiska kapselträffar, HP=0 och ny match. En aktiv PeerConnection per spelare behålls; gästen har ingen fysikvärld.

En sparad **mätpunkt vid matchslut** gav 7.6 fps. Under detta fönster har matchfysiken hunnit frysas. Det är därför varken ett långt medelvärde för spel eller ett löfte om stabil FPS. De upp till 180 senaste bildrutornas CPU-anrop till två renderare hade median 2.50 ms och p95 6.00 ms. Det senast rapporterade fysiksteget, samplat per bildruta, hade median 2.90 och p95 7.00 ms; efter frysning upprepas sista stegets värde. Använd det separata fysikprovet för stegfördelningen.

Renderingstid mäter CPU-inlämning, inte färdig GPU-rasterisering eller videokodning. Den låga faktiska FPS:n visar att software WebGL/mediearbetet i denna testmiljö är en begränsning trots kortare CPU-renderanrop. Ingen garanti om 60 fps ges. För långa bildrutor redovisas förkastad ikapptid i HUD, så simuleringen kan gå långsammare i väggtid på en överbelastad host.

## Budgetar och avgränsningar

- Intakt murverk är statiskt; lossnade block är rigidbodies och får sova.
- Kapslar hålls upprätta och löser enkla kollisionsformer i befintlig värld.
- Rörelse/look slås ihop normalt i högst 25 paket/s, med liten köbudget. Fire/interact skickas omedelbart, state cirka 10 Hz. Röst är RTP, inte spel-input i DataChannel.
- Ljud har två virtuella lyssnare och högst 24 aktiva källor. Röst ersätter ett förhandlat spår, utan extra PeerConnection eller renegotiation per PTT-tryck.
- Partikel-/fragmentbudgetar från v0.4 ligger kvar: högst 2400 effektpartiklar och 20 000 kosmetiska fragment. De skapar ingen skada eller fler rigidbodies. V0.4:s stressrapport finns kvar som historik; 20 000-fragmentsläget garanteras inte vara spelbart på alla klienter.

**Återstår:** riktiga GPU:er, fysiska Android/iOS-enheter, Safari, verkliga mikrofoner/eko, längre matcher och två externa nät. Röstprovet kontrollerar avkodad icke-noll audioenergi i båda riktningar och spelljud med låtsasmikrofon, inte upplevd ljudkvalitet hos hårdvara. Ljudcodec/browser kan påverka stereo och kräver praktisk kontroll.

Råa sammanfattningar finns i [performance-v0.5.json](performance-v0.5.json). Screenshots och större testsnapshots genereras i test-results/ och skickas inte till Git.
