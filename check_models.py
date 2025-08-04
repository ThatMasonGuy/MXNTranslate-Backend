import argostranslate.package
import argostranslate.translate

# Make sure packages are loaded
argostranslate.package.get_installed_packages()

# Get the installed languages
installed_languages = argostranslate.translate.get_installed_languages()

for lang in installed_languages:
    print(f"Language: {lang.code}")
    # Correct way in 1.9.x — `get_translation()` doesn't expose all targets, so we use installed packages instead
    for pkg in argostranslate.package.get_installed_packages():
        if pkg.from_code == lang.code:
            print(f"  → Translates to: {pkg.to_code}")
