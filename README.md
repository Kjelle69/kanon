# Kanon v0.5 – Mr Trebuchet

Två spelare ansluter med en sexsiffrig matchkod på **https://kanon.mtecproductions.se**. Varje spelare kan gå bakom sin borgs skydd eller bemanna sin kanon. **Hosten ensam** simulerar båda karaktärerna, skott, murar, ras och skador och renderar två 640 × 480-kameror. Gästen får kamera B som WebRTC-video och skickar input via samma anslutnings DataChannel.

## Spela

1. Välj **Skapa spel** eller **Anslut till spel**. Båda börjar till fots med 100 HP. Skott är spärrade tills motspelaren har anslutit.
2. **WASD/pilar** går framåt/bakåt och i sidled. Klicka i spelvyn för **muslås** och titta med musen; **Esc** släpper låset. Muskänslighet kan ändras med reglaget. På telefon används joystick och pekstyrd kamera direkt ovanpå videon.
3. Gå nära din kanon och tryck **E** eller **Bemanna / lämna**. Vid kanonen styr musen eller WASD/pilar siktet; **blanksteg/Skjut** avfyrar. Lätt ammunition laddar på 2 s, tung på 6 s. E återgår till gång. Det går inte att skjuta till fots.
4. **Aktivera ljud** om webbläsaren kräver det. Skott, träffar och ras får separata ljudperspektiv utifrån respektive spelares position och riktning.
5. **Aktivera mikrofon** är frivilligt och begär webbläsarens tillstånd först vid tryck. Håll **V** eller **Tala** för push-to-talk. **Stäng mikrofon** stoppar inspelningsspåren. Röst fungerar både till fots och vid kanonen; nekad mikrofon stoppar inte spelet.
6. Hälsomätarna visar bådas HP. Direktträff ger exakt 50 HP skada; krevader och fallande stenar kan också skada. Vid 0 HP visas vinnaren och spelstyrningen stoppas. **Till lobbyn · ny match** avslutar rummet; samma sidor kan skapa en ny kod med återställd hälsa.

Gästens video har inga HTML5-kontroller: blanksteg skjuter och pausar aldrig videon. Textfält får vanliga tangentfunktioner. Håll hostens spelvy aktiv; webbläsare kan strypa bakgrundsflikar.

## Arkitektur och tillgångar

- `public/game/characters.js`: kapslar, rörelse, gravitation, markkontakt, egna spelplaner och kanoninteraktion.
- `damage.js`: auktoritativ HP, direktträffar, kontinuerlig explosionsskada, stenskydd, kontaktskador och vinnare.
- `scene.js`, `physics.js`, `effects.js`: befintlig hostmotor, strukturell destruktion och två kameror. Egen kropp döljs för den egna kameran; motståndarens visas och har träffbar collider.
- `audio.js`: två virtuella lyssnare och separata spelljudsmixar. `voice.js`: valfri mikrofon och PTT. Samma **enda PeerConnection** transporterar video, spelljud och röst.
- `streaminglab.js`: tangentbord, mus, joystick, touch, HP-gränssnitt och hostvalidering. Rörelse/look samlas normalt i högst 25 paket/s; skott och interaktion har separat omedelbar hantering.

Den tillhandahållna karaktären heter **MrTreb.glb**. Laddaren stöder även namnet MrTrebuchet.glb, utan att originalet behöver döpas om. Cannonball.glb har tillkommit och används; FBX-kula stöds fortfarande. Originalfilerna bevaras.

**V0.4 är återställningsbar med taggen `v0.4-stable` på commit 363a220**, inklusive tangentbordsfixen. Serverkoden, Cloudflare och systemtjänster ändras inte av v0.5. Den oförändrade lobbyserverns `/healthz` anger fortfarande 0.2.0.

## Testa och köra

```sh
npm ci
npm run assets
npm test                       # 19 server-/fysiktester
npm run test:e2e                # 10 Chromium-tester, inklusive två verkliga sessioner
npm run benchmark:characters   # fysik med två kapslar och borgarna
npm run benchmark:physics      # samma murprov utan karaktärer
```

Playwright använder systemets `/usr/bin/chromium`, en separat server på 127.0.0.1:8091 och en genererad testton som låtsasmikrofon. Det spelar inte in en riktig mikrofon. Testbilder och råa mätvärden hamnar under test-results/.

För drift: `systemctl status kanon.service`, `journalctl -u kanon.service -f`, `curl http://127.0.0.1:8080/healthz`. Den körande tjänsten serverar uppdaterade statiska filer direkt, utan omstart.

Se [v0.5-dokumentationen](docs/v0.5.md) och [prestandarapporten](docs/performance-v0.5.md). V0.4:s destruktionsapproximationer beskrivs fortfarande i [docs/v0.4.md](docs/v0.4.md).

## Begränsningar

Modellen saknar rigg/animationer; kroppen följer fysiken men har ingen gånganimation. Kapselkontrollen saknar hopp och särskild trapp-/klättringslogik. Ljudet är en fungerande första procedurgenererad integration, inte färdiga inspelade ljudeffekter eller full akustiksimulering. Fysiska telefoner, Safari, mikrofon/eko och två externa nät behöver slutprovas.

Murverk använder stöd-/lastgraf och rigidbodies, inte full materialmekanik. Små kosmetiska splitter ger ingen skada; godtycklig meshfragmentering återstår. ICE/STUN/TURN har inte ändrats. Om TURN behövs ska det ligga utanför Pi:n, så att spelmedia fortsatt inte passerar Pi-servern.
