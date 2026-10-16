// Claude Code SessionStart hook (.claude/settings.json): tells the AI at the
// start of every conversation whether the setup is still to do, so a new
// person never has to type "set me up".
import { personalPacks } from './packs.mjs';

const packs = personalPacks();
const unfinished = packs.find((p) => p.setupOpen > 0);
if (!packs.length) {
  console.log(
    'LearningCenter: this person has NO personal pack yet. In your very first reply, whatever they wrote, greet them in one or two sentences and start the guided setup from ONBOARDING.md (CLAUDE.md → "Start here"). Do not wait for "set me up".',
  );
} else if (unfinished) {
  console.log(
    `LearningCenter: the setup of ${unfinished.dir} is not finished (${unfinished.setupOpen} open items in SETUP.md). In your first reply offer to continue it where it stopped.`,
  );
} else {
  console.log(`LearningCenter: personal pack(s): ${packs.map((p) => p.dir).join(', ')}.`);
}
