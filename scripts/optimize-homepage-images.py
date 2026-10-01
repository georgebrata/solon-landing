import os
from PIL import Image

def process_image(src_path, dest_path, max_width=None, max_height=None, quality=82, fmt='WEBP'):
    if not os.path.exists(src_path):
        print(f'Missing source: {src_path}')
        return

    with Image.open(src_path) as img:
        # Palette PNGs store transparency in tRNS, not as an alpha mode.
        # Converting those to RGB flattens transparent pixels to black.
        has_alpha = img.mode in ('RGBA', 'LA', 'PA') or 'transparency' in img.info
        if has_alpha and img.mode != 'RGBA':
            img = img.convert('RGBA')
        elif not has_alpha and img.mode != 'RGB':
            img = img.convert('RGB')

        orig_w, orig_h = img.size
        new_w, new_h = orig_w, orig_h

        if max_width and new_w > max_width:
            new_h = int(new_h * (max_width / new_w))
            new_w = max_width

        if max_height and new_h > max_height:
            new_w = int(new_w * (max_height / new_h))
            new_h = max_height

        if (new_w, new_h) != (orig_w, orig_h):
            img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)

        os.makedirs(os.path.dirname(dest_path), exist_ok=True)
        img.save(dest_path, format=fmt, quality=quality, optimize=True)
        orig_size = os.path.getsize(src_path) / 1024
        new_size = os.path.getsize(dest_path) / 1024
        print(f'{src_path} ({orig_w}x{orig_h}, {orig_size:.1f}KB) -> {dest_path} ({new_w}x{new_h}, {new_size:.1f}KB)')

if __name__ == '__main__':
    print('--- OPTIMIZING SERVICII BACKGROUND ---')
    process_image('assets/img/servicii-digitale-complete-pentru-avocati-solon.jpg',
                  'assets/img/servicii-digitale-complete-pentru-avocati-solon.webp',
                  max_width=1920, quality=80)

    print('\n--- OPTIMIZING RESPONSIVE HERO & SKILLS ---')
    process_image('assets/img/responsive/hero-img-780w.png', 'assets/img/responsive/hero-img-400w.webp', max_width=400)
    process_image('assets/img/responsive/hero-img-780w.png', 'assets/img/responsive/hero-img-520w.webp', max_width=520)
    process_image('assets/img/responsive/hero-img-780w.png', 'assets/img/responsive/hero-img-780w.webp', max_width=780)

    process_image('assets/img/responsive/skills-1024w.png', 'assets/img/responsive/skills-400w.webp', max_width=400)
    process_image('assets/img/responsive/skills-1024w.png', 'assets/img/responsive/skills-640w.webp', max_width=640)
    process_image('assets/img/responsive/skills-1024w.png', 'assets/img/responsive/skills-1024w.webp', max_width=1024)

    print('\n--- OPTIMIZING CASE STUDIES ---')
    case_studies = [
        ('assets/img/portfolio/marinau-case-study.png', 'marinau-case-study'),
        ('assets/img/portfolio/nagy-case-study.png', 'nagy-case-study'),
        ('assets/img/portfolio/dumitrescu-case-study.png', 'dumitrescu-case-study'),
        ('assets/img/portfolio/tslaw-case-study.png', 'tslaw-case-study'),
        ('assets/img/portfolio/CGR-case-study.png', 'cgr-case-study'),
    ]

    for src, name in case_studies:
        for w in [480, 960, 1440]:
            process_image(src, f'assets/img/responsive/{name}-{w}w.webp', max_width=w, quality=80)

    print('\n--- OPTIMIZING TEAM IMAGES ---')
    team = [
        ('assets/img/team/guritanu-portret.png', 'assets/img/team/guritanu-portret.webp', 432),
        ('assets/img/team/dumitrescu2.png', 'assets/img/team/dumitrescu2.webp', 432),
        ('assets/img/team/mihai.png', 'assets/img/team/mihai.webp', 443),
        ('assets/img/team/sebi.png', 'assets/img/team/sebi.webp', 500),
        ('assets/img/team/eduard.png', 'assets/img/team/eduard.webp', 400),
        ('assets/img/team/dan.png', 'assets/img/team/dan.webp', 600),
        ('assets/img/team/oana.png', 'assets/img/team/oana.webp', 400),
        ('assets/img/team/george.jpeg', 'assets/img/team/george.webp', 400),
    ]

    for src, dest, max_w in team:
        process_image(src, dest, max_width=max_w, quality=82)

    print('\n--- OPTIMIZING CLIENT LOGOS ---')
    clients = [
        ('assets/img/clients/client-tslaw.png', 'assets/img/clients/client-tslaw.webp', 500),
        ('assets/img/clients/client-asnn.png', 'assets/img/clients/client-asnn.webp', 250),
        ('assets/img/clients/client-m.png', 'assets/img/clients/client-m.webp', 250),
        ('assets/img/clients/client-nisteioana.png', 'assets/img/clients/client-nisteioana.webp', 250),
        ('assets/img/clients/client-evaluare-imobiliara-logo.png', 'assets/img/clients/client-evaluare-imobiliara-logo.webp', 282),
        ('assets/img/clients/client-cgr.png', 'assets/img/clients/client-cgr.webp', 300),
        ('assets/img/clients/client-ald.png', 'assets/img/clients/client-ald.webp', 300),
        ('assets/img/clients/client-mmc.png', 'assets/img/clients/client-mmc.webp', 400),
        ('assets/img/clients/client-blo.png', 'assets/img/clients/client-blo.webp', 400),
        ('assets/img/clients/client-igz.png', 'assets/img/clients/client-igz.webp', 300),
        ('assets/img/clients/client-p.png', 'assets/img/clients/client-p.webp', 250),
    ]

    for src, dest, max_w in clients:
        process_image(src, dest, max_width=max_w, quality=85)

    print('\n--- OPTIMIZING LOGOS & MISC ---')
    misc = [
        ('assets/img/solon-logo.png', 'assets/img/solon-logo.webp', 250),
        ('assets/img/solon-logo-dark.png', 'assets/img/solon-logo-dark.webp', 250),
        ('assets/img/circuits-down.png', 'assets/img/circuits-down.webp', 300),
        ('assets/img/why-us.png', 'assets/img/why-us.webp', 800),
        ('assets/img/anpc-sal.png', 'assets/img/anpc-sal.webp', 500),
    ]

    for src, dest, max_w in misc:
        process_image(src, dest, max_width=max_w, quality=85)
