import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import auto_publish


class ArticleGenerationTests(unittest.TestCase):
    def test_compact_mode_for_low_detail_story(self):
        story = {
            'title': 'Budget plan announced',
            'summary': 'Officials described a new plan for the coming year.'
        }
        self.assertEqual(auto_publish.choose_article_mode(story, source_count=1), 'compact')

    def test_long_mode_for_rich_story(self):
        story = {
            'title': 'Federal regulators open antitrust investigation into major tech merger after weeks of public pressure and testimony from lawmakers',
            'summary': 'The investigation centers on a proposed merger that would combine two large firms, with officials citing competitive concerns, market share, and potential effects on consumers after a series of hearings and a 14-month review that included testimony from executives, economists, and lawmakers.'
        }
        self.assertEqual(auto_publish.choose_article_mode(story, source_count=1), 'long')

    def test_deduplicate_repeated_paragraphs(self):
        text = "The hearing began with opening statements.\n\nThe hearing began with opening statements.\n\nOfficials later outlined the next steps."
        result = auto_publish.deduplicate_paragraphs(text)
        self.assertEqual(result.split('\n\n').count('The hearing began with opening statements.'), 1)
        self.assertIn('Officials later outlined the next steps.', result)


if __name__ == '__main__':
    unittest.main()
