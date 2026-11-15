# Draws client/simple/static/img/whatsnew/linux-night.svg (the What's new card's Linux night sky).
# Re-render: python3 brand/whatsnew/linux-night.py  (from the repo root), then npm run build in client/simple.
import random, math
random.seed(7)
W, H = 640, 352
def pine(cx, base, h, w, dark="#2c4560", gold="#f3d38c"):
    # stacked tiers, each a triangle with a dipped hem; a thin gold rim down the right edge of each (sunset light)
    tiers = 5
    out = []
    trunk_top = base  # the ground hides the trunk
    for i in range(tiers):
        frac = i / tiers
        hem = trunk_top - h * 0.86 * frac            # bottom of this tier
        top = hem - h * 0.36 * (1 - frac * 0.45)     # apex of this tier
        half = w / 2 * (1 - frac * 0.72)
        dip = h * 0.025
        body = f"M{cx:.1f},{top:.1f} L{cx + half:.1f},{hem:.1f} Q{cx:.1f},{hem - dip:.1f} {cx - half:.1f},{hem:.1f} Z"
        out.append(f'<path d="{body}" fill="{dark}"/>')
        # rim: from the apex down the right side, a sliver ~2.2 px wide that tapers out at both ends
        t = 2.2
        rim = (f"M{cx + 0.4:.1f},{top + 1.5:.1f} L{cx + half - 0.6:.1f},{hem - 0.6:.1f} "
               f"L{cx + half - t * 2.4:.1f},{hem - t * 0.9:.1f} L{cx + t * 0.2:.1f},{top + t * 4:.1f} Z")
        out.append(f'<path d="{rim}" fill="{gold}" opacity="0.92"/>')
    return "".join(out)

svg = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMax slice">',
'''<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#1d5a8f"/><stop offset="0.45" stop-color="#3f86b5"/><stop offset="0.72" stop-color="#7cbad6"/><stop offset="0.9" stop-color="#cfe2d6"/><stop offset="1" stop-color="#f1e7bf"/>
</linearGradient>
<radialGradient id="halo"><stop offset="0" stop-color="#fff" stop-opacity="0.55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
</defs>''',
f'<rect width="{W}" height="{H}" fill="url(#sky)"/>']
# faint stars
for _ in range(70):
    x, y = random.uniform(0, W), random.uniform(0, H * 0.62)
    svg.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{random.uniform(0.5, 1.3):.2f}" fill="#fff" opacity="{random.uniform(0.25, 0.75):.2f}"/>')
# constellations
cons = [[(40, 46), (58, 30), (92, 52), (86, 96)], [(520, 40), (556, 34), (592, 66), (588, 110)], [(210, 150), (238, 128), (262, 146)]]
for c in cons:
    svg.append(f'<polyline points="{" ".join(f"{x},{y}" for x, y in c)}" fill="none" stroke="#fff" stroke-opacity="0.35" stroke-width="0.8"/>')
    for i, (x, y) in enumerate(c):
        if i == 1:
            svg.append(f'<circle cx="{x}" cy="{y}" r="9" fill="url(#halo)"/><circle cx="{x}" cy="{y}" r="5" fill="none" stroke="#fff" stroke-opacity="0.45"/>')
        svg.append(f'<circle cx="{x}" cy="{y}" r="1.7" fill="#fff"/>')
# shooting star
svg.append('<line x1="330" y1="18" x2="392" y2="46" stroke="#fff" stroke-opacity="0.5" stroke-width="1" stroke-linecap="round"/>')
# mountains
svg.append('<polygon points="0,300 70,262 130,282 210,240 300,276 360,250 440,280 520,246 600,272 640,258 640,352 0,352" fill="#8cb9d6" opacity="0.9"/>')
svg.append('<polygon points="0,318 90,290 170,306 260,284 340,304 430,288 520,306 640,286 640,352 0,352" fill="#5d8db3"/>')
# trees: left group, right group
for cx, base, h, w in [(34, 340, 270, 150), (112, 344, 215, 120), (178, 346, 150, 86), (220, 344, 92, 54)]:
    svg.append(pine(cx, base, h, w))
for cx, base, h, w in [(608, 340, 260, 146), (532, 344, 200, 112), (470, 346, 140, 80), (430, 344, 86, 50)]:
    svg.append(pine(cx, base, h, w))
# ground
svg.append('<path d="M0,352 L0,334 Q160,318 320,326 T640,330 L640,352 Z" fill="#2c4560"/>')
# a little penguin on the hill, looking at the sky (Linux's mascot, as a silhouette)
px, py = 360, 326
svg.append(f'<g fill="#2c4560"><ellipse cx="{px}" cy="{py - 11}" rx="7" ry="11"/><circle cx="{px}" cy="{py - 24}" r="5.5"/>'
           f'<path d="M{px - 6},{py - 13} q-6,4 -4,10 z"/><path d="M{px + 6},{py - 13} q6,4 4,10 z"/>'
           f'<path d="M{px + 4},{py - 25} l5,1 -5,2 z"/><ellipse cx="{px - 3}" cy="{py}" rx="3.5" ry="1.4"/><ellipse cx="{px + 3}" cy="{py}" rx="3.5" ry="1.4"/></g>')
svg.append('</svg>')
open("client/simple/static/img/whatsnew/linux-night.svg", "w").write("".join(svg))
print("ok")
