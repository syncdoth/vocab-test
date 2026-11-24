create table public.class_settings (
  id boolean primary key default true check (id),
  start_date date not null default (now() at time zone 'Asia/Seoul')::date,
  schedule_key uuid not null default gen_random_uuid()
);
insert into public.class_settings default values;

create table public.class_profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  login text not null unique check (login ~ '^[a-z0-9][a-z0-9._-]{2,31}$'),
  auth_email text not null,
  name text not null check (char_length(name) between 1 and 80),
  role text not null check (role in ('teacher', 'student')),
  active boolean not null default true,
  must_change_password boolean not null default false,
  password_lock_until timestamptz,
  session_version integer not null default 0
);
create unique index class_single_teacher on public.class_profiles (role) where role = 'teacher';

create table public.class_sessions (
  fingerprint text primary key check (char_length(fingerprint) = 64),
  user_id uuid not null references public.class_profiles (id) on delete cascade,
  version integer not null,
  expires_at timestamptz not null
);
create index class_sessions_user on public.class_sessions (user_id);

create table public.class_attempts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.class_profiles (id) on delete restrict,
  test_date date not null,
  attempt_number integer not null check (attempt_number >= 1),
  questions jsonb not null check (jsonb_array_length(questions) = 50),
  answers jsonb not null default '[]' check (jsonb_array_length(answers) <= 50),
  started_at timestamptz not null,
  deadline timestamptz not null,
  finished_at timestamptz,
  score integer check (score between 0 and 50),
  timed_out boolean not null default false,
  unique (student_id, test_date, attempt_number),
  check ((finished_at is null) = (score is null))
);
create unique index class_one_active_attempt on public.class_attempts (student_id) where finished_at is null;
create index class_attempts_by_date on public.class_attempts (test_date, student_id);
create index class_attempts_history on public.class_attempts (student_id, finished_at desc, id);

alter table public.class_settings enable row level security;
alter table public.class_profiles enable row level security;
alter table public.class_sessions enable row level security;
alter table public.class_attempts enable row level security;
revoke all on public.class_settings, public.class_profiles, public.class_sessions, public.class_attempts from public, anon, authenticated;
grant select, insert, update, delete on public.class_settings, public.class_profiles, public.class_sessions, public.class_attempts to service_role;

create function public.class_score(p_questions jsonb, p_answers jsonb)
returns integer language sql immutable set search_path = '' as $$
  select count(*)::integer
  from jsonb_array_elements(p_questions) with ordinality as question(item, position)
  where question.item->>'wordId' = p_answers->>(question.position::integer - 1);
$$;

create function public.class_expire(p_student uuid default null)
returns setof public.class_attempts language sql set search_path = '' as $$
  update public.class_attempts as attempt
  set finished_at = deadline, score = public.class_score(questions, answers), timed_out = true
  where finished_at is null and deadline <= clock_timestamp()
    and (p_student is null or student_id = p_student)
  returning attempt.*;
$$;

create function public.class_start(p_student uuid, p_date date, p_questions jsonb, p_retake boolean)
returns public.class_attempts language plpgsql set search_path = '' as $$
declare
  attempt public.class_attempts;
  started timestamptz;
  today date;
  class_start date;
  next_number integer;
begin
  perform 1 from public.class_profiles
    where id = p_student and role = 'student' and active and not must_change_password for update;
  if not found then raise exception 'Student access is unavailable'; end if;

  perform public.class_expire(p_student);
  select * into attempt from public.class_attempts
    where student_id = p_student and finished_at is null;
  if found then return attempt; end if;

  started := clock_timestamp();
  today := (started at time zone 'Asia/Seoul')::date;
  select start_date into class_start from public.class_settings where id;
  if p_date < class_start or p_date > today then raise exception 'That test date is unavailable'; end if;

  select coalesce(max(attempt_number), 0) + 1 into next_number
    from public.class_attempts where student_id = p_student and test_date = p_date;
  if next_number = 1 and p_date < today - 7 then raise exception 'The makeup window has closed'; end if;
  if (next_number > 1) is distinct from p_retake then
    raise exception 'This test status changed. Refresh the page and try again';
  end if;

  insert into public.class_attempts (student_id, test_date, attempt_number, questions, started_at, deadline)
    values (p_student, p_date, next_number, p_questions, started, started + interval '10 minutes')
    returning * into attempt;
  return attempt;
end;
$$;

create function public.class_answer(p_student uuid, p_attempt uuid, p_index integer, p_choice integer)
returns public.class_attempts language plpgsql set search_path = '' as $$
declare
  attempt public.class_attempts;
  received_at timestamptz;
  selected text;
begin
  perform 1 from public.class_profiles
    where id = p_student and role = 'student' and active and not must_change_password for update;
  if not found then raise exception 'Student access is unavailable'; end if;

  select * into attempt from public.class_attempts where id = p_attempt and student_id = p_student for update;
  if not found then raise exception 'Attempt was not found'; end if;
  if attempt.finished_at is not null then return attempt; end if;

  received_at := clock_timestamp();
  if received_at >= attempt.deadline then
    select * into attempt from public.class_expire(p_student);
    return attempt;
  end if;

  if p_index <> jsonb_array_length(attempt.answers) then return attempt; end if;
  selected := attempt.questions->p_index->'choiceIds'->>p_choice;
  if selected is null or p_index < 0 or p_choice not between 0 and 3 then
    raise exception 'Select an answer before submitting';
  end if;
  attempt.answers := attempt.answers || jsonb_build_array(selected);
  if jsonb_array_length(attempt.answers) = 50 then
    attempt.finished_at := received_at;
    attempt.score := public.class_score(attempt.questions, attempt.answers);
  end if;

  update public.class_attempts
    set answers = attempt.answers, finished_at = attempt.finished_at, score = attempt.score
    where id = attempt.id;
  return attempt;
end;
$$;

create function public.class_missed_words(p_student uuid)
returns table (word_id text, missed integer, unanswered integer)
language sql stable set search_path = '' as $$
  select q.item->>'wordId', count(*)::integer,
    count(*) filter (where (attempt.answers->>(q.position::integer - 1)) is null)::integer
  from public.class_attempts attempt
  cross join lateral jsonb_array_elements(attempt.questions) with ordinality as q(item, position)
  where attempt.student_id = p_student and attempt.attempt_number = 1 and attempt.finished_at is not null
    and q.item->>'wordId' is distinct from attempt.answers->>(q.position::integer - 1)
  group by q.item->>'wordId'
  order by count(*) desc, q.item->>'wordId';
$$;

revoke all on function public.class_score(jsonb, jsonb), public.class_expire(uuid),
  public.class_start(uuid, date, jsonb, boolean), public.class_answer(uuid, uuid, integer, integer),
  public.class_missed_words(uuid) from public, anon, authenticated;
grant execute on function public.class_score(jsonb, jsonb), public.class_expire(uuid),
  public.class_start(uuid, date, jsonb, boolean), public.class_answer(uuid, uuid, integer, integer),
  public.class_missed_words(uuid) to service_role;
