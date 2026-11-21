<!-- Write all pull request text in Simplified Technical English (ASD-STE100): short sentences, one instruction per sentence, simple approved vocabulary, and the active voice. -->

## Thinking Path

<!--
  Required. Trace your reasoning from the top of the project down to this
  specific change. Start with what Paperclip is, then narrow through the
  subsystem, the problem, and why this PR exists. Use blockquote style.
  Aim for 5–8 steps. See CONTRIBUTING.md for full examples.
-->

> - Paperclip is the open source app people use to manage AI agents for work
> - [Which subsystem or capability is involved]
> - [What problem or gap exists]
> - [Why it needs to be addressed]
> - This pull request ...
> - The benefit is ...

## Linked Issues or Issue Description

<!--
  Required. Pick ONE of the two paths below.

  (A) Issue exists — replace the placeholder below with your issue links.
      Tag each linked issue with `Fixes: #123`, `Closes #123`, or `Refs #123`.
      Include duplicates and closely related issues too.

  Only reference PUBLIC GitHub issues/PRs here. Do NOT paste internal,
  instance-local Paperclip references — ticket ids like PAPA-123 / PAP-224,
  /PAP/issues/... or agent://... links, or localhost/tailnet URLs. Other
  contributors cannot open them. See CONTRIBUTING.md → "No Internal Issue
  References".

  (B) No issue exists — describe the underlying problem here. Follow the issue
      template that fits your change. Open the matching file and copy its field
      labels into your description:
        • Bug:         .github/ISSUE_TEMPLATE/bug_report.yml
        • Feature:     .github/ISSUE_TEMPLATE/feature_request.yml
        • Adapter:     .github/ISSUE_TEMPLATE/adapter_request.yml
        • Enhancement: .github/ISSUE_TEMPLATE/enhancement.yml
        • Docs:        .github/ISSUE_TEMPLATE/docs_issue.yml
      An automated check reads the literal bold labels AND the content under
      each label. Keep at least three of these labels, each alone on its own
      line, and write real content under each. A label with only the bare "-"
      placeholder does not count, and the check fails.

  See CONTRIBUTING.md → "Link Issues or Describe Them In-PR".
-->

-

## What Changed

<!-- Bullet list of concrete changes. One bullet per logical unit. -->

-

## Verification

<!--
  How can a reviewer confirm this works? Include test commands, manual
  steps, or both.
-->

-

## Risks

<!--
  What could go wrong? Mention migration safety, breaking changes,
  behavioral shifts, or "Low risk" if genuinely minor.
-->

-



## Checklist

- [ ] I have included a thinking path that traces from project context to this change
- [ ] I have run tests locally and they pass
- [ ] I have added or updated tests where applicable
- [ ] I have updated relevant documentation to reflect my changes
- [ ] I have considered and documented any risks above
- [ ] All Paperclip CI gates are green
- [ ] Greptile is 5/5 with no open P2s, recommendations, or follow-ups
- [ ] I will address all Greptile and reviewer comments before requesting merge
