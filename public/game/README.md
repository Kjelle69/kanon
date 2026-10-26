# Hostmotor och lobbyadapter v0.5

Normalflödets enda PeerConnection ägs av lobby.js. Den transporterar kamera B, separat spelljud, reserverad valfri röst och DataChannel. Servern hanterar endast statiska filer, lobby och offer/answer/ICE.

- streaminglab.js: input, muslås/touch, HUD, validering, befintligt KanonGame-gränssnitt.
- scene.js: två förstapersonskameror och hostens gemensamma scen. Egen karaktär döljs per renderpass.
- characters.js: kapselkroppar, gång/look, bemanning, markkontakt och spelplansgränser.
- damage.js: hostens enda HP-/skadesystem och matchresultat.
- physics.js/effects.js: bevarad ballistik, strukturellt ras och kosmetiska effekter.
- models.js: kanon, kula och Mr Trebuchet, med separat fysikproxy.
- audio.js: virtuella lyssnare och lokalt/fjärran spelljud. voice.js: mikrofon, PTT och städning.
- ui.js: en åtgärd per touchtryck, fortsatt mus-/tangentbordsstöd.

KanonGame.start/getGuestStream/onInput/onReady/onDisconnect/snapshot finns kvar. onState uppdaterar gästens HUD. På hosten skapar start en CannonScene; på gästen ingen simulering. getGuestStream innehåller kamera B och dess spelljud. Guest motion innehåller axlar/look, aldrig position eller skada. Host state är en liten auktoritativ HUD-rapport, inte en extra fysiksimulering.

/game/diagnostic.html är oförändrad äldre Streaminglab 0.1 med manuell signaling, utan v0.5-karaktärer eller röst. Använd normalflödet för de nya funktionerna.

Se docs/v0.5.md och taggen v0.4-stable för återställningsbar föregående implementation.
