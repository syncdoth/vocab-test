# Vocab Daily

Personal vocabulary practice based on the VZIP Ascent and Summit PDFs. The app serves 50 English word-to-meaning questions each day. An attempt lasts 10 minutes, advances one card per answer, and saves the result automatically. Unanswered words count as incorrect at timeout.

## Run locally

Open a terminal at the project root and run:

```sh
python3 -m http.server 8000 --directory site
```

Visit http://localhost:8000. The site uses browser-native JavaScript modules and has no build or package installation step.

## Tests and history

- The first visit starts the schedule. New sets unlock at midnight in Asia/Seoul, and earlier sets stay open for makeup.
- The 2,400 words are shuffled in 48-day cycles. Retakes use the same words with reshuffled question order and choices.
- History keeps the first attempt as the daily score. It lists retakes separately.
- The deadline and answers survive refreshes. If the browser is closed when a test expires, the next visit records the timeout.
- Results belong to the current browser and site address. Clearing site data removes them.

## Vocabulary

The two uploaded PDFs contain 1,600 Ascent entries and 800 Summit entries. The public site ships the word, part of speech, and English definition fields in `site/data/vocabulary.json`. The PDFs themselves are outside the repository.

To regenerate the dataset with Poppler installed, pass the two PDFs in Ascent, Summit order:

```sh
python3 scripts/import_vocab.py path/to/ascent.pdf path/to/summit.pdf
```

## Hosting

Select **GitHub Actions** under the repository's **Settings → Pages**. The included workflow publishes the `site/` directory on pushes to `main`.

For a later Vercel and Supabase version, the UI, quiz logic, and browser storage adapter are separate ES modules. The vocabulary rows have stable source IDs. A class version can add Supabase Auth, associate attempts with users, and move answer evaluation and deadline checks to the server. Check that the intended use fits the [Vercel Hobby terms](https://vercel.com/docs/plans/hobby) and [Supabase Free limits](https://supabase.com/pricing) before migrating.
