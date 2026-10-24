# Streaminglab 0.1 integration i Kanon v0.3

- `/`: normalt spelflöde via matchkod. lobby.js importerar streaminglab.js innan knapparna aktiveras.
- `streaminglab.js`: originalets CannonScene, med adapter och livscykelstädning. Ingen PeerConnection skapas här.
- `/game/index.html`: hänvisning till lobbyn.
- `/game/diagnostic.html`: originalets manuella signaling i separat flik. diagnostic.js skapar den anslutning som enbart används i det läget.
- `/vendor/`: samma Three.js 0.180.0 som originalet använde, nu lokalt.

Adapter window.KanonGame:
- start({role, sendInput}): startar bara hos host en ny CannonScene; gästen visar video och kontroller.
- getGuestStream(): hostens previewCanvas.captureStream(30), kamera B, 640×480.
- onInput(command): hostens validerade mottagning av key/ammo/fire för spelare 2.
- onReady(): gästen skickar vald ammunition när styrkanalen öppnats.
- onDisconnect(): stoppar animation, stream och GPU-resurser samt återställer input/roll/UI.
- snapshot(): diagnostisk ögonblicksbild utan skrivbar referens till motorn.

lobby.js äger den enda PeerConnection, DataChannel och signaling i normalflödet. Den lägger gästströmmen på anslutningen före offer och kopplar mottagna styrkommandon till onInput. Spelkommandon går aldrig via WebSocket-servern.

Originalfilen finns i projektets backup under backups/ (utanför public/).
