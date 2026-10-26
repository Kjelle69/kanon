# Modeller

`cannon.glb` är den tillhandahållna originalfilen, 6 366 400 byte. Den ändras inte av byggskriptet. Ursprunglig SHA-256: 9d5056bfa2dc7c6b9ae093b11284c62f37521eb5de9be7648c84a9e774100bce.

Kör `npm run assets` efter installation. Skriptet kopierar låsta loaders/fysikberoenden och extraherar originalets inbäddade PNG-bilder till textures/ med image-manifest.json. Bilderna kan då laddas via HTTPS utan att ändra serverns säkerhetspolicy. Kalibreringen av just denna modell finns i public/game/models.js.

Lägg den kommande modellen på `cannonball.fbx`, tillsammans med eventuella refererade texturer. FBXLoader använder den om den är giltig. När FBX saknas används cannonball.glb om den finns, annars en sfär. Ladda om sidan efter att tillgångarna ändrats. Faktisk FBX-geometri och material behöver granskas när filen finns.

## V0.5

Mr Trebuchet levererades som **MrTreb.glb**, 456 488 byte, SHA-256 8aed48f91604d3a0e2c80ab476f0e876a92b4f041c3fe0aeb5b0c794e6af23df. Laddaren stöder också det begärda namnet MrTrebuchet.glb. Ingen av filerna behöver döpas om. Den befintliga modellen har inga bilder eller animationer; höjd, framåtriktning och displaybas hanteras i models.js utan att ändra originalfilen.

**cannonball.glb** tillkom under v0.5-arbetet, 10 524 byte, SHA-256 795d2351a7331c87b1776b37ed17743782f1d66d3a3cacfb52f4d578d8ac3716. Den används när FBX saknas; fallback-sfär finns kvar om ingen kulmodell kan laddas. Original-GLB för karaktär, kula och kanon bevaras oförändrade.
