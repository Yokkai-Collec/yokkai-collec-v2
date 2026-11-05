# Feu photographique de la vitrine

Les anciennes bordures animées haut/bas ne sont plus affichées. Le thème présente uniquement des foyers irréguliers au pied des cartes, derrière leur illustration.

Assets créés avec l’outil intégré imagegen, puis optimisés avec Sharp :

- `public/images/showcase-fire-flipbook.webp` : séquence photographique générée, 16 cellules sur 4 × 4, transparence réelle ; 878 090 octets.
- `public/images/showcase-fire-still.webp` : première cellule, pour la miniature et le chargement de secours.

Il s’agit d’une texture générée et animée en séquence, pas d’une captation vidéo. Le renderer interpole les cellules à 30 images/s maximum, décale les phases et vitesses des foyers, et abaisse le feu au centre. Il ne construit aucune silhouette de flamme en CSS/SVG. La lueur CSS sert uniquement d’éclairage.

Le canvas conserve une image fixe avec `prefers-reduced-motion`. Il arrête sa boucle hors écran et lorsque l’onglet est masqué. L’intensité nulle désactive le renderer. Le DPR est plafonné à 1,5. Les overlays ne capturent aucun événement ; cartes, molette et glissement restent utilisables. Aucun changement SQL.

## Prompt final — outil intégré, sans CLI

```text
Create a production VFX animation sprite sheet, not a mockup or illustration. Exactly 4 columns and 4 rows, 16 equal rectangular cells, no gaps. Overall canvas landscape 2:1 ratio, ideally 2048x1024 so every cell is 512x256. Each cell is one consecutive frame of the SAME small photorealistic fire bed seen straight on against genuine alpha transparency. Read cells left to right, top to bottom. Natural fluid orange flames rising from a thin bright amber fire bed along the bottom of EACH cell, with translucent wispy red orange tips, occasional tiny ember. Irregular low fire, three asymmetric tongues reaching about 65 percent cell height, not giant walls. Advance flame motion gradually between frames with soft turbulent curling, keep fire bed and camera locked, last frame returns near first for loop. Fire like cinematic filmed combustion with fine turbulent texture and luminous golden filaments, deep amber and delicate reds, no cartoon geometric shapes, no thick outlines, no black or checkerboard background. Every cell's upper third is completely transparent. Never let flames cross cell boundaries. No text, numbers, borders, objects, labels, or contact shadows. This is a clean professional transparent fire flipbook texture for a dark trading-card showcase.
```
