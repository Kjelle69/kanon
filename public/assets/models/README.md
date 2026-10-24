# Modeller

`cannon.glb` är den tillhandahållna originalfilen, 6 366 400 byte. Den ändras inte av byggskriptet. Ursprunglig SHA-256: 9d5056bfa2dc7c6b9ae093b11284c62f37521eb5de9be7648c84a9e774100bce.

Kör `npm run assets` efter installation. Skriptet kopierar låsta loaders/fysikberoenden och extraherar originalets inbäddade PNG-bilder till textures/ med image-manifest.json. Bilderna kan då laddas via HTTPS utan att ändra serverns säkerhetspolicy. Kalibreringen av just denna modell finns i public/game/models.js.

Lägg den kommande modellen på `cannonball.fbx`, tillsammans med eventuella refererade texturer. FBXLoader använder den om den är giltig, annars visas en sfär. Ladda om sidan efter att tillgångarna ändrats. Faktisk FBX-geometri och material behöver granskas när filen finns.
