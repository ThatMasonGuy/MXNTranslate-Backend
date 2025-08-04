# -*- coding: utf-8 -*-
import sys
import argostranslate.package
import argostranslate.translate
from lingua import Language, LanguageDetectorBuilder

# Load ArgosTranslate models
argostranslate.package.update_package_index()
argostranslate.translate.load_installed_languages()

# Read input text from stdin
text = sys.stdin.read()

# Get CLI args
from_code = sys.argv[1]
to_code = sys.argv[2]

# Detect language if needed
if from_code == "auto":
    try:
        supported_languages = [
            Language.ENGLISH,
            Language.JAPANESE,
            Language.SPANISH,
            Language.FRENCH,
            Language.GERMAN,
            Language.KOREAN,
            Language.CHINESE,
            Language.RUSSIAN,
            Language.PORTUGUESE,
            Language.TURKISH
        ]

        detector = LanguageDetectorBuilder.from_languages(*supported_languages).build()

        print("DEBUG: Running language detection...", file=sys.stderr)

        # Get full confidence dump
        candidates = detector.compute_language_confidence_values(text)

        if not candidates:
            print("error: unable to detect language (no candidates)", file=sys.stderr)
            sys.exit(1)

        print("LINGUA_CONFIDENCE_DUMP:", file=sys.stderr)
        for lang_conf in candidates:
            iso = lang_conf.language.iso_code_639_1.name.lower()
            score = round(lang_conf.value * 100, 2)
            print(f"  {iso}: {score}%", file=sys.stderr)

        best = candidates[0]
        from_code = best.language.iso_code_639_1.name.lower()

    except Exception as e:
        print(f"error: failed during language detection — {e}", file=sys.stderr)
        sys.exit(1)

# Show what was detected
print(f"DETECTED_LANG_DEBUG|||{from_code}|||{to_code}", file=sys.stderr)

# Skip same-language
if from_code == to_code:
    print(f"error: source and target language are both '{to_code}'", file=sys.stderr)
    sys.exit(1)

# Match against ArgosTranslate models
installed_languages = argostranslate.translate.get_installed_languages()
from_lang = next((l for l in installed_languages if l.code == from_code), None)
to_lang = next((l for l in installed_languages if l.code == to_code), None)

if not from_lang or not to_lang:
    print("error: language not installed", file=sys.stderr)
    sys.exit(1)

# Validate translation pair
try:
    translation = from_lang.get_translation(to_lang)
except Exception:
    print(f"error: no translation available from '{from_code}' to '{to_code}'", file=sys.stderr)
    sys.exit(1)

# Translate and return
translated_text = translation.translate(text)
print(f"{from_code}|||{translated_text}")
