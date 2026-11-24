# Vocab Daily

Daily vocabulary practice based on the VZIP Ascent and Summit PDFs. Select a meaning and press **Submit answer** to advance. An attempt has 50 questions and a 10-minute deadline. Unsubmitted answers count as incorrect at timeout.

## Classroom

Students sign in with a teacher-issued ID and temporary password, then choose their own password. Everyone gets the same daily word set in Korea time, with independently shuffled questions and choices. A missed first attempt can be made up during the following seven calendar days. Retakes open after a first attempt and stay in their own history. Correct answers are available immediately after the attempt ends.

Supabase saves submitted answers, in-progress attempts, official scores, and retakes. The teacher page shows daily completion status, individual history, and the 30 most missed words across each student's first attempts. Archiving a student revokes access and keeps their results available to the teacher.

### Set up Supabase Free and Vercel Hobby

1. Create a Supabase Free project with the Data API enabled. Apply [the classroom migration](supabase/migrations/20261124000100_classroom.sql) in the SQL Editor or use `supabase db push --remote` with Supabase CLI v3 in a linked checkout. The migration starts the shared schedule on its application date in Korea time.
2. In Supabase Authentication, turn off public sign-ups and create the teacher account with an email and a password. Mark the email as confirmed when creating the user. In the SQL Editor, register the account as the classroom teacher, replacing the sample address with that account's email:

   ```sql
   insert into public.class_profiles (id, login, auth_email, name, role)
   select id, 'teacher', email, 'Teacher', 'teacher'
   from auth.users
   where email = 'teacher@example.com';
   ```

3. In a personal Vercel Hobby account, import this repository at its root. Add the three server environment variables from [`.env.example`](.env.example) using the Supabase project URL, publishable key, and secret key. The secret key belongs in Vercel's server environment. [Supabase API key setup](https://supabase.com/docs/guides/getting-started/api-keys)
4. Deploy and sign in with the `teacher` login ID and the password you set in Supabase. Use **Create student** to provision each student and share the generated login details directly with them.

The classroom build uses Node.js 22 and publishes only the classroom interface to `dist/`. For local development against a configured Supabase project, run `npm run build` and `npx vercel dev` with the variables in `.env.local`. The Vercel function reads the vocabulary bank server-side and grades submissions against the database deadline.

## Personal GitHub Pages version

The personal version continues to serve the static `site/` directory. It keeps results in the current browser. Classroom accounts start with their own history.

Open a terminal at the project root and run:

```sh
python3 -m http.server 8000 --directory site
```

Visit http://localhost:8000. The `pages.yml` workflow publishes this version to GitHub Pages.

## Vocabulary

The two uploaded PDFs contain 1,600 Ascent entries and 800 Summit entries. The public site ships the word, part of speech, and English definition fields in `site/data/vocabulary.json`. The PDFs themselves are outside the repository.

To regenerate the dataset with Poppler installed, pass the two PDFs in Ascent, Summit order:

```sh
python3 scripts/import_vocab.py path/to/ascent.pdf path/to/summit.pdf
```
