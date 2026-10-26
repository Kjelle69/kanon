# WebRTC-fördröjning – mätning 2026-10-26

**Rapporterad felmiljö:** Edge, Windows 11. **Faktiskt provad miljö:** två separata Chromium-processer på samma Raspberry Pi 5, Linux, headless/SwiftShader. Två fysiska datorer och Windows/Edge har inte verifierats. Den obegränsat växande fördröjningen kunde inte reproduceras här; resultatet får inte tolkas som bevis att originalfelet är löst på användarens dator.

## Vad mätningen visar

Medianer efter de första åtta sekunderna. Korta A–E-prov är ungefär 24 s och kan påverkas av uppstart/ordning. De två långproven är minst 600 s vardera.

| Scenario | Begärd FPS | Spelljud till gäst | Bildålder ms | Avkodad FPS | Jitterbuffert ms | DataChannel-RTT ms |
|---|---:|---|---:|---:|---:|---:|
| Ren video, ingen fysik/partikeluppdatering | 30 | Nej | 118 | 29,3 | 8,8 | 8,0 |
| Ren video | 60 | Nej | 156 | 32,6 | 36,7 | 5,5 |
| Spel/fysik/ras | 30 | Nej | 304 | 10,5 | 40,9 | 2,8 |
| Spel/fysik/ras | 30 | Ja | 336 | 10,5 | 69,2 | 3,3 |
| Spel/fysik/ras | 60 | Nej | 287 | 10,5 | 22,2 | 10,1 |
| Ursprunglig gemensam A/V-synkgrupp, **10 min** | 60 | Ja | **425** | 10,5 | **160,1** | 4,3 |
| Försök: jitterBufferTarget=0, 60 s | 60 | Ja | 496 | 10,5 | 225,2 | 3,7 |
| Försök: skilda synkgrupper, 60 s | 60 | Ja | 314 | 10,9 | 43,2 | 4,8 |
| Skilda synkgrupper, **10 min** | 60 | Ja | **313** | 11,0 | **46,3** | 5,3 |

Enbart video klarar alltså nära 30 faktiska fps; begärda 60 uppnås inte i denna mjukvarumiljö. Med hela spelet produceras/kodas/avkodas ungefär 10–11 fps. Kodning tar omkring 7 ms och avkodning omkring 1–2 ms per bild. Skickad/avkodad/presenterad bildfrekvens följs åt. Detta pekar på hostens bildproduktion snarare än en gästdecoder som faller allt längre efter. DataChannel-kön var liten och svarstiden mycket lägre än bildåldern. Data-ping mäter transport plus JS-schemaläggning, inte hela input→fysik→videobild-kedjan.

Att `jitterBufferTarget=0` inte hjälpte motiverar ingen sådan standardändring. Under det provet låg önskad buffert över den redovisade minimibufferten, medan separerade synkgrupper låg nära minimum. Tillsammans med skillnaden med/utan ljud stöder detta att **A/V-synk bidrar till onödig fast videofördröjning** i det provade upplägget. Proven är sekventiella och inte randomiserade; varm shadercache/CPU-belastning påverkar absoluta tider. Detta identifierar en mätbar del av latensen, inte säkert orsaken till användarens växande Edge-fördröjning.

## Begränsad åtgärd

Spelljud och video spelades redan i separata HTML-element, men fick samma MSID/synkgrupp i SDP. Spelljud får nu ett eget **audio-only MediaStream-ID** när spåret läggs på den befintliga PeerConnection. Ingen extra PeerConnection, videostream, fysikvärld eller återkommande omförhandling skapas. Röstspåret och spelljudsmixen är kvar. Det innebär att exakt ljud-/bildsynk kan bli sämre; lägre videolatens prioriteras enligt uppdraget.

Inga försök görs att söka i MediaStream-video med currentTime, ändra playbackRate eller regelbundet starta om anslutningen. Ingen receiver-jitterhint aktiveras, eftersom den inte gav uppmätt nytta. Ingen ändring av fysik, Cloudflare eller systemtjänst behövdes. Användarens befintliga ändring i characters.js (hastighet 15) lämnas orörd.

## Tiominuterskontroll och resurser

Före ändringen var medianbildåldern 431 ms under sekund 60–180 och 419 ms under sekund 480–slut. Efter ändringen var motsvarande värden 324 respektive 300 ms. Spelartidslinjens relativa drift var cirka −1,2 respektive +1,3 ms, baserat på skillnaden mellan mätt väggtid och video.currentTime. Inget av långproven visade växande uppspelningskö. Förbättringen i total median var cirka **112 ms**, med bibehållet ljud.

Alla nio mätmatcher hade exakt en aktiv PeerConnection per klient, en aktiv canvas-videostream hos hosten och en schemalagd animationsloop. Efter leave fanns **0 aktiva PC, 0 levande capture-streams och 0 schemalagda spel-RAF** i testets instrumentering. Scene.dispose stoppar animation/fysik/audio och gamla capture-spår; diagnostiktimer och videoframe-callback avregistreras vid matchslut. Permanenta inputlisteners finns en gång per sida, inte en gång per match. Inga nya JavaScript-renderjobb eller resurser ackumulerades i detta prov; detta är inte en full GPU-/heap-profil.

Spelproven omfattar aktiv fysik, skott och ett ras i början, därefter en fortsatt ansluten session. De är **inte tio minuters oavbruten intensiv strid**. En binär tidstämpel ritades i testets video så att verklig bildålder kunde avläsas med samma dators klocka. Mätmarkören och testhooks finns bara i testharnessen, inte i spelet, och tillför viss renderingskostnad. Två datorers osynkade Date.now får inte jämföras på detta sätt.

## Ny diagnostik, varannan sekund

Öppna **WebRTC · latens och historik** på båda sidor. Historiken är begränsad till 180 prover, normalt sex minuter, och kan visas/skrollas eller exporteras som JSON.

- Host: framesSent, framesEncoded, totalEncodeTime och kodningstid per bild.
- Gäst: framesReceived, framesDecoded, framesPerSecond, framesDropped, freezeCount, totalDecodeTime och avkodningstid per bild.
- Medeldröjning per intervall: `1000 × ΔjitterBufferDelay / ΔjitterBufferEmittedCount`. Samma beräkning för target/minimum där browsern ger fälten.
- Video paused, readyState, currentTime, sidans visibility och presenterade fps från requestVideoFrameCallback/presentedFrames.
- RTT via valt ICE-par, separat DataChannel-ping, paketförlust, bitrate och aktuell kanal-kö.
- RTCP-estimerad capture/receive-age där API:t erbjuder metadata. Detta är ett estimat och ersätter inte en fysisk end-to-end-mätning.

Räknare sparas även kumulativt för granskning, men intervallvärden använder differenser. Saknade fält eller räknarreset visas som saknade, inte fabricerade nollor. Uppskjuten getStats överlappar inte med nya läsningar; historik och gamla stats-ID:n är begränsade. Frames per second från browsern är en gauge, medan verklig intervall-FPS räknas separat.

## Reproducera och gå vidare i Edge

```sh
node --test test/rtc-diagnostics.test.js test/lobby.test.js
node scripts/rtc-probe.mjs
RTC_SOAK_ONLY=1 RTC_REPORT=/tmp/rtc-soak.json node scripts/rtc-probe.mjs
```

Harnessen använder en egen server på 127.0.0.1:8092 och två Chromium-processer. Inga tjänster behöver stoppas. `RTC_CASES` kan ange JSON-lista med mode=video/game, fps=30/60, audio, duration i sekunder samt shared=true för den gamla synkgruppen eller hint=0 för det ej införda jitterförsöket. Playwrights headless-/bakgrundsflaggor och mjukvaru-GPU skiljer sig från riktig Edge på Windows.

Ladda om båda Edge-sidorna för att få diagnostiken. Vid fortsatt fel: exportera bådas historik medan felet pågår. Om framesDecoded ligger nära framesReceived men presenterad FPS sjunker, undersök presentation/sidans visibility. Om jitter/target och bildålder växer men data-RTT förblir låg pekar det mot media-playout. Om även kodad FPS faller finns problemet tidigare i kedjan. Ändra inte Edge-/GPU-inställningar på gissning. Kontroll med två fysiska datorer och riktig Edge/Windows återstår.

Sammanfattningar: [rtc-latency-results.json](rtc-latency-results.json). Fulla 2-sekundsprover finns komprimerade i rtc-baseline-2026-10-26.json.gz, rtc-controls-2026-10-26.json.gz och rtc-final-2026-10-26.json.gz. Återskapa rapporten med scripts/rtc-report.py när råfilerna finns i /tmp.

API-definitioner: [W3C WebRTC statistics](https://www.w3.org/TR/webrtc-stats/), [requestVideoFrameCallback](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback) och [jitterBufferTarget](https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpReceiver/jitterBufferTarget).
