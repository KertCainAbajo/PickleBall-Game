# Custom 3D characters

Realistic 3D mode ships with an athletic mannequin shown in team colors, because no realistic human models are freely available to bundle. To get **realistic people**, add any **Adobe Mixamo** character; Mixamo is free with an Adobe account.

## Add a character

1. Go to https://www.mixamo.com and sign in.
2. Under **Characters**, pick one. Sporty ones include Kaya, Jody, Remy, Leonard and Shannon.
3. Click **Download**, choose **Format: FBX Binary**, **Pose: T-pose**, then download.
4. Convert the FBX to `.glb`. For example, open it in [Blender](https://www.blender.org/) (free) and use **File → Export → glTF 2.0 (.glb)**.
5. Put the `.glb` file in this folder, for example `assets/characters/kaya.glb`.
6. Edit `manifest.json` in this folder to map a roster character to the file:

```json
{
  "luna": "kaya.glb",
  "ace": "remy.glb"
}
```

The keys are roster ids: ace, luna, theo, grace, ray, kai, mina, diego, zoe, hank, priya and sam. The game loads your model whenever that character is picked. Walking, running and the paddle swing are applied automatically, because every Mixamo character shares the same skeleton.

## Licensing

Mixamo characters and animations are free to use in your own projects, including commercial ones. They may not be redistributed as standalone assets. That's fine inside a game, but check Adobe's current terms before publishing.
