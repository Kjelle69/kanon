# Kanon v0.4 – Destruction & Physics

Två spelare ansluter med en sexsiffrig matchkod på **https://kanon.mtecproductions.se**. Hosten simulerar båda borgarna och renderar två kameror i **640 × 480**. Gästens kamera B skickas som WebRTC-video; styrkommandon går via samma anslutnings DataChannel. Servern hanterar endast webbapp, lobby och signaling.

## Nytt i v0.4

- Den tillhandahållna sjudelade `cannon.glb`, med separat elevationspivot, riktning och mynning, används i båda borgarna. `cannonball.fbx` är förberedd med FBXLoader; filen saknas ännu och kulan visas som sfär.
- Cannon-es ger fast 60 Hz rigidbody-fysik, gravitation, kolliderande rasmassor, sleeping och återaktivering. Svepta sfärtester hindrar snabba kulor från att passera murarna.
- Varje murblock har massa, boxform, hållfasthet och stödrelationer. Försvagade förbindelser kan brista; förlorat stöd släpper block till riktig fysiksimulering. Fallande block kan orsaka nya skador.
- Piprekyl, kameraskakning, mynningsflamma, ljusblixt, gnistor, krutrök, stendamm och poolade kosmetiska fragment. Lokala träbränder följer föremålet; eld skadar inte automatiskt sten.
- Pekknappar för telefon samt diagnostik för rendering, fysik, rigidbodies, strukturförbindelser, effekter och videobitrate. Stressläget använder högst 20 000 **kosmetiska** fragment.

**V0.3 är bevarad som Git-taggen `v0.3-stable` på commit `809c6d3`.** De nytillagda modellfilerna har inte ändrats. Cloudflare, serverkoden, systemd-enheten och körande systemtjänster har lämnats oförändrade. Webbappen/paketet är v0.4; den oförändrade lobbyserverns `/healthz` anger fortfarande 0.2.0.

## Spela

Välj **Skapa spel** eller ange matchkoden och välj **Anslut till spel**. Sikta med WASD, piltangenter eller pekknappar. Välj lätt/tung ammunition och skjut med knappen eller blanksteg. Båda spelarna styr oberoende; laddtiderna är 2 respektive 6 sekunder. Klicka i spelvyn för tangentbordsfokus.

**Lämna spel** avslutar för båda. En ny match kan startas på samma sidor, även med omvända roller. Hosten bör hålla fliken aktiv eftersom webbläsare kan strypa bakgrundsanimation.

Öppna **Diagnostik** för mätvärden, kosmetiskt stressläge och testbrand i trälådor. `/game/diagnostic.html` behåller det äldre Streaminglab 0.1-flödet med manuell signaling som separat regressionsdiagnostik. Det laddas inte i normalflödet och innehåller inte v0.4-fysiken.

## Installera och testa

```sh
npm ci
npm run assets             # återställ lokala loaders, fysikmodul och extraherade texturer
npm test                   # server + fysik, 12 tester
npm run test:e2e           # riktiga Chromium/WebGL/WebRTC-tester, 6 tester
npm run benchmark:physics  # reproducerbart fysikprov med två borgar
```

Playwright använder `/usr/bin/chromium`, mjukvaru-WebGL och en egen server på `127.0.0.1:8091`. Den publika tjänsten behöver inte stoppas. Bilder och råa mätvärden skapas i `test-results/`. För drift: `systemctl status kanon.service`, `journalctl -u kanon.service -f`, `curl http://127.0.0.1:8080/healthz`.

Teknik, approximationer, modellkalibrering, tester och begränsningar beskrivs i [docs/v0.4.md](docs/v0.4.md). Uppmätta prestanda finns i [docs/performance-v0.4.md](docs/performance-v0.4.md).

## Kvarstående begränsningar

Strukturen använder en dokumenterad stöd-/lastapproximation; det är ingen fullständig murverks- eller materialmekanik. Stora lossnade block är riktiga rigidbodies, små synliga splitter är kosmetiska. Ett modulgränssnitt för framtida meshfragmentering finns, men godtycklig geometrisk uppdelning av sten är inte implementerad.

FBX-kulan måste tillföras och granskas när filen finns. Mobiltesterna använder Chromium-emulering; riktiga telefoner, Safari och anslutning mellan två externa nät återstår att verifiera. ICE/STUN/TURN är oförändrat; `/config` innehåller för närvarande inga ICE-servrar. Ingen TURN-relätrafik ska placeras på Pi:n.
