import argostranslate.package
import argostranslate.translate

# Load available remote packages
argostranslate.package.update_package_index()
available = argostranslate.package.get_available_packages()

langs = ["en", "es", "de", "ja", "ru", "tr", "fr", "zh", "ar", "pt", "ko", "hi"]

def install_lang_pair(from_code, to_code):
    for pkg in available:
        if pkg.from_code == from_code and pkg.to_code == to_code:
            print(f"📦 Installing: {from_code} → {to_code}")
            downloaded_path = pkg.download()
            argostranslate.package.install_from_path(downloaded_path)
            return
    print(f"❌ Not available: {from_code} → {to_code}")

# Install all pairwise combinations
for src in langs:
    for tgt in langs:
        if src != tgt:
            install_lang_pair(src, tgt)
