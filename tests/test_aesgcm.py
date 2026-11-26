"""AES-256-GCM against the test cases of its specification, and what must make it refuse.

The four cases are the 256-bit ones with a 96-bit IV of the GCM specification (McGrew and Viega, test cases 13 to
16): values that any AES-GCM gives. tests/test_lock.py checks the same code against WebCrypto, under node."""
import os
import unittest

from tools import aesgcm

h = bytes.fromhex
KEY = h("feffe9928665731c6d6a8f9467308308feffe9928665731c6d6a8f9467308308")
IV = h("cafebabefacedbaddecaf888")
PLAIN = h("d9313225f88406e5a55909c5aff5269a86a7a9531534f7da2e4c303d8a318a721c3c0c95956809532fcf0e2449a6b525"
          "b16aedf5aa0de657ba637b391aafd255")
AAD = h("feedfacedeadbeeffeedfacedeadbeefabaddad2")
CIPHER = ("522dc1f099567d07f47f37a32a84427d643a8cdcbfe5c0c97598a2bd2555d1aa8cb08e48590dbb3da7b08b1056828838"
          "c5f61e6393ba7a0abcc9f662898015ad")
CASES = (
    ("13: nothing to encrypt", bytes(32), bytes(12), b"", b"", "", "530f8afbc74536b9a963b4f1c4cb738b"),
    ("14: one block of zeros", bytes(32), bytes(12), b"", bytes(16), "cea7403d4d606b6e074ec5d3baf39d18",
     "d0d1c8a799996bf0265b98b5d48ab919"),
    ("15: four blocks", KEY, IV, b"", PLAIN, CIPHER, "b094dac5d93471bdec1a502270e3cc6c"),
    ("16: a partial block and associated data", KEY, IV, AAD, PLAIN[:60], CIPHER[:120],
     "76fc6ece0f4e1768cddf8853bb2d551b"),
)


class TestAesGcm(unittest.TestCase):
    def test_the_cases_of_the_specification(self):
        for name, key, iv, aad, data, cipher, tag in CASES:
            with self.subTest(name):
                sealed = aesgcm.seal(key, iv, data, aad)
                self.assertEqual(sealed.hex(), cipher + tag)
                self.assertEqual(aesgcm.unseal(key, iv, sealed, aad), data)

    def test_the_substitution_box_is_the_standards(self):
        self.assertEqual((aesgcm.SBOX[0x00], aesgcm.SBOX[0x53], aesgcm.SBOX[0xFF]), (0x63, 0xED, 0x16))  # FIPS-197
        self.assertEqual(sorted(aesgcm.SBOX), list(range(256)))

    def test_any_length_comes_back(self):
        key, iv = os.urandom(32), os.urandom(12)
        for n in (0, 1, 15, 16, 17, 255, 256, 1000):
            data = os.urandom(n)
            sealed = aesgcm.seal(key, iv, data, b"label")
            self.assertEqual(len(sealed), n + 16)
            self.assertEqual(aesgcm.unseal(key, iv, sealed, b"label"), data)
            if n:
                self.assertNotIn(data, sealed)

    def test_anything_that_is_not_what_was_sealed_is_refused(self):
        key, iv, data = os.urandom(32), os.urandom(12), b"the page, compressed" * 9
        sealed = aesgcm.seal(key, iv, data, b"label")
        flip = lambda b, i: b[:i] + bytes([b[i] ^ 1]) + b[i + 1:]  # noqa: E731
        for name, args in (("another key", (flip(key, 5), iv, sealed, b"label")),
                           ("another IV", (key, flip(iv, 0), sealed, b"label")),
                           ("other associated data", (key, iv, sealed, b"labem")),
                           ("a changed byte", (key, iv, flip(sealed, 7), b"label")),
                           ("a changed tag", (key, iv, flip(sealed, len(sealed) - 1), b"label")),
                           ("a cut end", (key, iv, sealed[:-1], b"label")),
                           ("less than a tag", (key, iv, b"short", b"label"))):
            with self.subTest(name), self.assertRaises(ValueError):
                aesgcm.unseal(*args)

    def test_only_a_256_bit_key_and_a_96_bit_iv(self):
        for key, iv in ((bytes(16), bytes(12)), (bytes(31), bytes(12)), (bytes(32), bytes(16)), (bytes(32), b"")):
            with self.assertRaises(ValueError):
                aesgcm.seal(key, iv, b"data")


if __name__ == "__main__":
    unittest.main()
