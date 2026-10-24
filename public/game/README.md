# Spelintegration v0.4

- `streaminglab.js`: roller, tangent-/pekstyrning och befintligt KanonGame-gränssnitt mot lobbyn.
- `scene.js`: hostens CannonScene, två 640×480-kameror, rendering och modell-/effektkoppling.
- `models.js`: lokala GLTFLoader/FBXLoader, källmodellens kalibrering, pivot och mynning.
- `physics.js`: fast 60 Hz Cannon-es, svepta projektiltester, stöd-/lastgraf och rigidbody-ras.
- `effects.js`: poolade partiklar, kosmetiskt splitter och lokala träbränder.
- `/game/diagnostic.html`: äldre Streaminglab 0.1 med manuell signaling. Detta är en separat regressionsdiagnostik, inte v0.4-motorn.

lobby.js äger fortfarande normalflödets enda RTCPeerConnection och DataChannel. Kamera B fångas från previewCanvas.captureStream(30) och läggs på den anslutningen innan offer. Gästen kör ingen simulering; endast hosten skapar CannonScene. Ingen spelvideo eller fysik passerar serverns API.

Adapter window.KanonGame har kvar start, getGuestStream, onInput, onReady, onDisconnect och snapshot. Snapshot ger kopierad diagnostik, inklusive modeller, mynningar, rigidbody-/strukturstatistik och effekter.

Se projektets docs/v0.4.md för approximationer, modellförberedelse, tester och begränsningar. Git-taggen v0.3-stable bevarar föregående motor.
