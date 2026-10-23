"""파티 영웅(프람·슈나이더) 3면도를 gpt-image-2로 만든다. 프라우 B_mid와 같은 4.5등신.
사용: uv run --no-project --with openai --with pillow python gen_sheet.py <fram|schneider> [출력 파일명]
입력: astrid/B_mid/turnaround.png(비율·포즈·렌더 스타일) + ploh/assets/heroes/<hero>/의 원작 일러스트(디자인)
병사용 ploh/tools/soldiers/gen_sheet.py와 같은 프롬프트 구조(픽셀 기준 비율, A-pose, 무기 없음)를 쓴다.
"""
import base64, io, sys
from pathlib import Path
from openai import OpenAI
from PIL import Image

PLOH = Path("/Users/lqez/dev/sandbox-games/ploh")
B_MID = PLOH / "game/assets/astrid/B_mid/turnaround.png"
REF = PLOH / "assets/heroes"
OUTD = PLOH / "game/assets"

SHEET = (
    "Character model turnaround sheet for a 3D modeler, 1536x1024 landscape. Exactly three full-body views of the SAME "
    "character side by side at identical scale, identical height and identical foot level, evenly spaced with each figure "
    "centred in its own third of the canvas, left to right: FRONT view, LEFT SIDE profile view (facing left, true "
    "90-degree profile), BACK view.\n"
    "PROPORTIONS (most important): copy the body proportions of the FIRST input image (the girl turnaround) exactly. "
    "The SECOND input image is an anime illustration of the character design; redraw that design in the girl's 4.5-head "
    "proportions: on the 1024-pixel-tall canvas the top of the head is near y=60 and the soles near y=910 (figure about "
    "850 px tall); the head from chin to top of the skull is about 190 px (22% of the height, {headnote}); the shoulders "
    "are at about y=290; the crotch is at about y=520; the hands reach about y=500; hands and feet slightly large. "
    "Use the first image ONLY for proportions, pose, layout and the clean smooth-shaded anime 3D game-model render "
    "style - NOT for clothing, face, hair or colours.\n"
    "DESIGN: the character from the SECOND input image (same outfit, armour, colours, hair). {design}\n"
    "POSE: strict symmetric A-pose like the first image: arms straight, angled about 40 degrees down from horizontal, "
    "clearly separated from the torso with plain background visible under each armpit and between each arm and the body "
    "all the way down; hands open and flat with the fingers held together, palms facing the thighs; legs straight, feet "
    "shoulder-width apart, toes pointing straight forward; head facing straight ahead.\n"
    "BACKGROUND: plain flat light-grey (#C8C8C8), no floor, no cast shadows, no text, no labels, no arrows, no frames.\n"
    "NO WEAPONS: the character holds NOTHING. Do NOT draw any sword, mace, club, shield, pole, weapon or prop anywhere "
    "on the sheet - only the three figures."
)

HEROES = {
    # 불 속성 '불꽃의 용병' 프람: 갈색 머리·붉은 눈·붉은 목도리·흰 망토·검은 원피스·은색 갑주
    "fram": (["fram/illust_fire.png"], "including the hair, not counting the antenna strand",
        "Fram Berge (fire version), a confident young female knight-mercenary: very long straight chestnut-brown hair "
        "with side-swept bangs, falling down the back to the waist (not lower), one long thin antenna strand (ahoge) "
        "curving up from the crown, sharp red eyes, a confident closed-mouth smile. Outfit: a black-navy high-necked "
        "sleeveless dress; a silver steel breastplate over the chest with a gold V-shaped chevron emblem and gold trim; "
        "a short crimson-red scarf-capelet wrapped around the neck and the tops of the shoulders, with two red tassels "
        "hanging in front of the chest and a brown leather collar strap with a gold diamond clasp; bare upper arms; "
        "black elbow-length gloves under silver articulated steel vambraces with gold bands on the forearms, and "
        "black-and-silver armoured gauntlets on the hands; the dress becomes a black skirt ending at mid-thigh, split "
        "at the front; black thigh-high stockings; silver knee-high armoured greaves with gold trim and pointed knee "
        "plates; silver-and-black armoured sabatons. A white cloak hangs from the back of the shoulders. IMPORTANT for "
        "3D rigging: the white cloak hangs straight down BEHIND the back, no wider than the shoulders, and ends at "
        "mid-thigh; in the front view only thin white edges of the cloak show behind the hips, and the arms are "
        "completely outside the cloak with plain background visible between each arm and the torso. The hair also "
        "stays behind the back and never touches the arms."),
    # 물 속성 '온화한 수인기사' 슈나이더: 금발·하늘색 목도리·흰 셔츠·갈색 가죽 조끼·검은 반바지
    "schneider": (["schneider/illust_water.png"], "including the hair; the dog ears hang down beside the head",
        "Schneider (water version), a cheerful young dog-kin (therian) knight: a round friendly dog-boy face with light "
        "tan skin, a small dark-brown dog nose on a short soft muzzle, big round dark-brown eyes, thick dark-brown "
        "eyebrows, rosy cheeks, a gentle closed-mouth smile; messy fluffy honey-blond hair with one curled antenna "
        "strand on top; long floppy brown dog ears hanging down on both sides of the head to the jaw line; a short "
        "fluffy cream-coloured dog tail coming out of the lower back just above the shorts, hanging down behind the "
        "buttocks without touching the legs. Outfit: a sky-blue neckerchief tied around the neck, its triangle hanging "
        "over the upper chest, with a row of small silver studs and one large round silver medallion; a white "
        "short-sleeved shirt with the sleeves cuffed above the elbows; a dark-brown leather corset-vest around the "
        "torso with brass buckles; black shorts with small gold buttons ending above the knees; brown leather gloves "
        "with wide brass-ringed cuffs on the hands; grey steel knee guards (round knee cops) over dark-brown leather "
        "thigh-high boots. Sturdy, stocky, broad-shouldered build with thick strong arms and legs (a strong little "
        "fighter), but the SAME total height and 4.5-head ratio as the first image."),
}


def flat(path):
    im = Image.open(path).convert("RGBA")
    bg = Image.new("RGBA", im.size, (200, 200, 200, 255)); bg.alpha_composite(im)
    b = io.BytesIO(); bg.convert("RGB").save(b, "PNG"); b.seek(0); b.name = Path(path).name
    return b


def gen(hero, name=None):
    refs, headnote, desc = HEROES[hero]
    out = OUTD / hero / (name or "turnaround.png")
    out.parent.mkdir(parents=True, exist_ok=True)
    fs = [open(B_MID, "rb")] + [flat(REF / r) for r in refs]
    try:
        r = OpenAI().images.edit(model="gpt-image-2", image=fs, prompt=SHEET.format(design=desc, headnote=headnote),
                                 size="1536x1024", quality="high")
    finally:
        for f in fs:
            f.close()
    out.write_bytes(base64.b64decode(r.data[0].b64_json))
    print("saved", out)


if __name__ == "__main__":
    gen(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
