import { conductor } from './conductor.ts';
import { filer } from './filer.ts';
import { intake } from './intake.ts';
import { organizer } from './organizer.ts';
import { packager } from './packager.ts';
import { questions } from './questions.ts';
import { renderer } from './renderer.ts';
import { scout } from './scout.ts';
import type { Roles } from './types.ts';

export const roles: Roles = { conductor, intake, filer, scout, organizer, renderer, packager, questions };
