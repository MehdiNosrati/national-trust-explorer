"""
Generate high-resolution 1200x630 Open Graph (OG) social card for National Trust Explorer
"""
from PIL import Image, ImageDraw, ImageFont
import os

width = 1200
height = 630

# Create gradient background
img = Image.new("RGBA", (width, height), (6, 61, 34, 255))
draw = ImageDraw.Draw(img)

# Draw subtle diagonal gradient
for y in range(height):
    ratio = y / height
    r = int(6 + (0 - 6) * ratio)
    g = int(61 + (122 - 61) * ratio)
    b = int(34 + (59 - 34) * ratio)
    draw.line([(0, y), (width, y)], fill=(r, g, b, 255))

# Draw decorative subtle background circles / map rings
overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
overlay_draw = ImageDraw.Draw(overlay)

# Map decorative circles on right side
cx, cy = 940, 315
for radius, alpha in [(120, 25), (200, 20), (280, 15), (360, 10)]:
    overlay_draw.ellipse(
        [(cx - radius, cy - radius), (cx + radius, cy + radius)],
        outline=(255, 255, 255, alpha),
        width=2
    )

# Decorative pins on the right
pins = [
    (940, 315, "📍", 24),
    (880, 240, "🏛️", 20),
    (980, 200, "🏰", 20),
    (890, 390, "🌸", 20),
    (1010, 380, "🌊", 20),
    (820, 330, "🌲", 18),
    (1040, 270, "⛪", 18)
]

img = Image.alpha_composite(img, overlay)
draw = ImageDraw.Draw(img)

# Typography using default/system fonts
try:
    font_badge = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 22)
    font_title = ImageFont.truetype("/System/Library/Fonts/Supplemental/Georgia Bold.ttf", 68)
    font_subtitle = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 28)
    font_pill = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 20)
    font_url = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 22)
except Exception:
    font_badge = ImageFont.load_default()
    font_title = ImageFont.load_default()
    font_subtitle = ImageFont.load_default()
    font_pill = ImageFont.load_default()
    font_url = ImageFont.load_default()

# Top Tag Pill
draw.rounded_rectangle([(80, 75), (420, 120)], radius=22, fill=(255, 255, 255, 38), outline=(255, 255, 255, 76), width=1)
draw.text((105, 87), "🏛️  678 UK HERITAGE SITES", font=font_badge, fill=(254, 240, 138))

# Main Title
draw.text((80, 155), "National Trust", font=font_title, fill=(255, 255, 255))
draw.text((80, 235), "Explorer & Map", font=font_title, fill=(187, 247, 208))

# Subtitle / Description
draw.text((80, 335), "Interactive map with live driving distances,", font=font_subtitle, fill=(226, 232, 240))
draw.text((80, 375), "travel times & opening guidelines across the UK.", font=font_subtitle, fill=(203, 213, 225))

# Feature Pills row
pills = [
    "🚗 Live Drive Times",
    "🏰 Castles & Houses",
    "🌸 Gardens & Coast",
    "📍 Any UK Origin"
]
x_offset = 80
for p in pills:
    bbox = font_pill.getbbox(p)
    pill_w = (bbox[2] - bbox[0]) + 30
    draw.rounded_rectangle([(x_offset, 450), (x_offset + pill_w, 492)], radius=12, fill=(255, 255, 255, 30), outline=(255, 255, 255, 60))
    draw.text((x_offset + 15, 460), p, font=font_pill, fill=(255, 255, 255))
    x_offset += pill_w + 14

# Bottom URL bar
draw.line([(80, 535), (1120, 535)], fill=(255, 255, 255, 50), width=1)
draw.text((80, 560), "Free Web App  •  mahdins.dev/national-trust-explorer", font=font_url, fill=(254, 240, 138))

# Save image
target_path = "/Users/mns/Desktop/projects/NT/og-image.png"
img.convert("RGB").save(target_path, "PNG", optimize=True)
print(f"Generated {target_path} ({os.path.getsize(target_path)} bytes)")
