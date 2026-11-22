import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("pliable_check_glibc", ROOT / "scripts" / "check_glibc.py")
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)

DUMP = """
/lib/x86_64-linux-gnu/libfoo.so:     file format elf64-x86-64

DYNAMIC SYMBOL TABLE:
0000000000000000      DF *UND*\t0000000000000000 (GLIBC_2.34) __libc_start_main
0000000000000000      DF *UND*\t0000000000000000 (GLIBC_2.2.5) malloc
0000000000000000  w   DF *UND*\t0000000000000000 (GLIBC_2.39) pthread_something
0000000000000000      DF *UND*\t0000000000000000  GLIBC_2.38 strlcpy
0000000000001000 g    DF .text\t0000000000000010 (GLIBC_2.40) defined_here
0000000000000000      DF *UND*\t0000000000000000 (GLIBCXX_3.4.30) _ZNSt6thread
"""


def test_needed_lists_only_undefined_glibc_symbols():
    found = checker.needed(DUMP)
    assert sorted(found) == [(2, 2), (2, 34), (2, 38), (2, 39)]
    assert found[(2, 38)] == "strlcpy"  # the form without brackets, as objdump prints for some files
    assert found[(2, 39)] == "pthread_something"  # a weak symbol, as in the failing release


def test_too_new_reports_versions_above_the_limit_oldest_first():
    assert [v for v, _ in checker.too_new(DUMP, (2, 35))] == [(2, 38), (2, 39)]
    assert checker.too_new(DUMP, (2, 39)) == []


def test_parse_version():
    assert checker.parse_version("2.35") == (2, 35)
    assert checker.parse_version("2.2.5") == (2, 2)


def test_is_elf(tmp_path):
    elf = tmp_path / "lib.so"
    elf.write_bytes(b"\x7fELF\x02\x01")
    text = tmp_path / "notes.txt"
    text.write_text("hello")
    assert checker.is_elf(elf) and not checker.is_elf(text) and not checker.is_elf(tmp_path / "missing")
