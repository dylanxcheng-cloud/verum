import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
STORIES_FILE = ROOT / 'stories.json'


class StoryImageTests(unittest.TestCase):
    def test_story_images_do_not_use_dicebear(self):
        with STORIES_FILE.open(encoding='utf-8') as fh:
            data = json.load(fh)

        stories = data.get('stories', {}) if isinstance(data, dict) else {}
        bad = []
        for story_id, story in stories.items():
            image = story.get('image', '')
            if isinstance(image, str) and ('api.dicebear.com' in image or 'dicebear' in image.lower()):
                bad.append((story_id, image))

        self.assertFalse(bad, f'Stories still contain DiceBear image URLs: {bad[:5]}')


if __name__ == '__main__':
    unittest.main()
