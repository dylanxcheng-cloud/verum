import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
FILES_TO_CHECK = [
    ROOT / 'auto_publish.py',
    ROOT / 'images.ts',
    ROOT / 'home.jsx',
    ROOT / 'article.jsx',
    ROOT / 'category.jsx',
    ROOT / 'src/utils/images.ts',
    ROOT / 'src/api/stories.ts',
]


class DiceBearPlaceholderTests(unittest.TestCase):
    def test_no_dicebear_image_urls_in_active_code(self):
        for path in FILES_TO_CHECK:
            self.assertTrue(path.exists(), f'Missing expected file: {path}')
            text = path.read_text(encoding='utf-8')
            self.assertNotIn('api.dicebear.com', text, f'{path.name} still references DiceBear URLs')
            self.assertNotIn('DiceBear', text, f'{path.name} still mentions DiceBear')


if __name__ == '__main__':
    unittest.main()
