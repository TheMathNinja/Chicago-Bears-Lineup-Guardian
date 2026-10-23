// Standalone precision dispatcher. Store GITHUB_WORKFLOW_TOKEN in Script Properties,
// run installLineupGuardianScheduler() once, and keep GitHub's cron as the backup.
const LINEUP_GUARDIAN = {
  owner: 'TheMathNinja',
  repo: 'Chicago-Bears-Lineup-Guardian',
  workflow: 'guardian.yml',
  initialWorkflow: 'initial-lineup.yml',
  tokenProperty: 'GITHUB_WORKFLOW_TOKEN',
  alertEmail: 'fili.mikey@gmail.com',
  season: 2026,
  lookaheadMinutes: 90
};

function runLineupGuardianScheduler() {
  const now = new Date();
  const props = PropertiesService.getScriptProperties();
  const slot = String(Math.floor(now.getTime() / 300000));
  if (props.getProperty('LINEUP_GUARDIAN_LAST_SLOT') === slot) return;

  const due = lineupGuardianDue_(now);
  if (!due.monitor && !due.initial) {
    props.setProperties({
      LINEUP_GUARDIAN_LAST_SLOT: slot,
      LINEUP_GUARDIAN_LAST_SKIP_AT: now.toISOString(),
      LINEUP_GUARDIAN_LAST_SKIP_REASON: due.reason,
      LINEUP_GUARDIAN_NEXT_KICKOFF: due.nextKickoff || ''
    });
    return;
  }

  const rateLimitUntil = Number(props.getProperty('LINEUP_GUARDIAN_RATE_LIMIT_UNTIL') || 0);
  if (rateLimitUntil > now.getTime()) {
    props.setProperties({
      LINEUP_GUARDIAN_LAST_SLOT: slot,
      LINEUP_GUARDIAN_LAST_SKIP_AT: now.toISOString(),
      LINEUP_GUARDIAN_LAST_SKIP_REASON: 'GitHub API rate-limit backoff until ' + new Date(rateLimitUntil).toISOString()
    });
    return;
  }

  const token = props.getProperty(LINEUP_GUARDIAN.tokenProperty);
  if (!token) throw new Error('Missing ' + LINEUP_GUARDIAN.tokenProperty + ' Script Property.');

  const easternDate = Utilities.formatDate(now, 'America/New_York', 'yyyy-MM-dd');
  if (due.initial &&
      props.getProperty('LINEUP_GUARDIAN_LAST_INITIAL_DATE') !== easternDate) {
    if (dispatchLineupGuardian_(LINEUP_GUARDIAN.initialWorkflow, token, props)) {
      props.setProperty('LINEUP_GUARDIAN_LAST_INITIAL_DATE', easternDate);
    }
  }
  const monitorDispatched = !due.monitor || dispatchLineupGuardian_(LINEUP_GUARDIAN.workflow, token, props);
  props.setProperties({
    LINEUP_GUARDIAN_LAST_SLOT: slot,
    LINEUP_GUARDIAN_LAST_SUCCESS_AT: monitorDispatched ? now.toISOString() :
      (props.getProperty('LINEUP_GUARDIAN_LAST_SUCCESS_AT') || ''),
    LINEUP_GUARDIAN_NEXT_KICKOFF: due.nextKickoff || ''
  });
}

function lineupGuardianDue_(now) {
  let response;
  try {
    response = UrlFetchApp.fetch(
      'https://api.myfantasyleague.com/' + LINEUP_GUARDIAN.season +
        '/export?TYPE=nflSchedule&JSON=1',
      {muteHttpExceptions: true}
    );
  } catch (error) {
    return {monitor: false, initial: false,
      reason: 'MFL NFL schedule request failed; native GitHub backup remains active: ' + error.message};
  }
  if (response.getResponseCode() !== 200) {
    return {monitor: false, initial: false,
      reason: 'MFL NFL schedule unavailable (HTTP ' + response.getResponseCode() + '); native GitHub backup remains active'};
  }

  const payload = JSON.parse(response.getContentText());
  const matchups = (payload.nflSchedule && payload.nflSchedule.matchup) || [];
  const rows = Array.isArray(matchups) ? matchups : [matchups];
  const kickoffs = rows.map(function(matchup) {
    return new Date(Number(matchup.kickoff) * 1000);
  }).filter(function(kickoff) {
    return !isNaN(kickoff.getTime());
  }).sort(function(a, b) {
    return a.getTime() - b.getTime();
  });
  if (!kickoffs.length) {
    return {monitor: false, initial: false,
      reason: 'MFL returned no current-week NFL kickoffs; native GitHub backup remains active'};
  }

  const lookaheadMs = LINEUP_GUARDIAN.lookaheadMinutes * 60 * 1000;
  const monitor = kickoffs.some(function(kickoff) {
    const delta = kickoff.getTime() - now.getTime();
    return delta >= 0 && delta <= lookaheadMs;
  });
  const firstKickoff = kickoffs[0];
  const easternDate = Utilities.formatDate(now, 'America/New_York', 'yyyy-MM-dd');
  const firstKickoffDate = Utilities.formatDate(firstKickoff, 'America/New_York', 'yyyy-MM-dd');
  const easternClock = Utilities.formatDate(now, 'America/New_York', 'HH:mm');
  const initial = easternDate === firstKickoffDate && easternClock >= '06:00' && easternClock < '07:00';
  const nextKickoff = kickoffs.filter(function(kickoff) {
    return kickoff.getTime() > now.getTime();
  })[0];
  return {
    monitor: monitor,
    initial: initial,
    nextKickoff: nextKickoff ? nextKickoff.toISOString() : '',
    reason: 'Outside an actual 90-minute NFL kickoff window'
  };
}

function dispatchLineupGuardian_(workflow, token, props) {
  const startedAt = new Date();
  const dispatchId = 'gas-' + Utilities.formatDate(startedAt, 'UTC', 'yyyyMMdd-HHmmss') +
    '-' + workflow.replace(/[^A-Za-z0-9]/g, '-');
  const url = 'https://api.github.com/repos/' + LINEUP_GUARDIAN.owner + '/' +
    LINEUP_GUARDIAN.repo + '/actions/workflows/' + workflow + '/dispatches';
  let lastCode = 0;
  let lastBody = '';

  for (let attempt = 1; attempt <= 4; attempt++) {
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      headers: githubHeaders_(token),
      contentType: 'application/json',
      payload: JSON.stringify({ref: 'main', inputs: {live: true, dispatch_id: dispatchId}}),
      muteHttpExceptions: true
    });
    lastCode = response.getResponseCode();
    lastBody = response.getContentText();
    if (lastCode === 204) return true;

    const headers = response.getHeaders();
    const remaining = githubHeader_(headers, 'x-ratelimit-remaining');
    if (lastCode === 403 && String(remaining || '') === '0') {
      const resetSeconds = Number(githubHeader_(headers, 'x-ratelimit-reset') || 0);
      const resetMs = resetSeconds > 0 ? resetSeconds * 1000 : Date.now() + 60 * 60 * 1000;
      props.setProperty('LINEUP_GUARDIAN_RATE_LIMIT_UNTIL', String(resetMs));
      const alertKey = 'LINEUP_GUARDIAN_RATE_LIMIT_ALERT_' + String(resetSeconds || Math.floor(resetMs / 3600000));
      if (props.getProperty(alertKey) !== 'sent') {
        MailApp.sendEmail(LINEUP_GUARDIAN.alertEmail, 'Lineup Guardian GitHub rate limit reached',
          'The precision dispatcher paused until ' + new Date(resetMs).toISOString() +
          '. GitHub\'s native ten-minute backup remains active.\n\n' + lastBody);
        props.setProperty(alertKey, 'sent');
      }
      return false;
    }

    if (lastCode >= 500 && lastCode <= 599) {
      if (lineupGuardianDispatchExists_(workflow, token, dispatchId, startedAt)) return;
      Utilities.sleep(attempt * 3000);
      continue;
    }
    break;
  }

  MailApp.sendEmail(LINEUP_GUARDIAN.alertEmail, 'Lineup Guardian dispatch failed',
    'GitHub returned HTTP ' + lastCode + ':\n\n' + lastBody);
  throw new Error('GitHub returned HTTP ' + lastCode + ': ' + lastBody);
}

function githubHeader_(headers, name) {
  const wanted = String(name).toLowerCase();
  const keys = Object.keys(headers || {});
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === wanted) return headers[keys[i]];
  }
  return '';
}

function githubHeaders_(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: 'Bearer ' + token,
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

function lineupGuardianDispatchExists_(workflow, token, dispatchId, startedAt) {
  const url = 'https://api.github.com/repos/' + LINEUP_GUARDIAN.owner + '/' +
    LINEUP_GUARDIAN.repo + '/actions/workflows/' + workflow +
    '/runs?event=workflow_dispatch&per_page=20';

  for (let poll = 1; poll <= 3; poll++) {
    Utilities.sleep(poll * 2000);
    const response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: githubHeaders_(token),
      muteHttpExceptions: true
    });
    if (response.getResponseCode() !== 200) continue;

    const runs = JSON.parse(response.getContentText()).workflow_runs || [];
    const found = runs.some(function(run) {
      return String(run.display_title || '').indexOf(dispatchId) !== -1 &&
        new Date(run.created_at).getTime() >= startedAt.getTime() - 60000;
    });
    if (found) return true;
  }
  return false;
}

function testLineupGuardianDispatchNow() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty(LINEUP_GUARDIAN.tokenProperty);
  if (!token) throw new Error('Missing ' + LINEUP_GUARDIAN.tokenProperty + ' Script Property.');
  dispatchLineupGuardian_(LINEUP_GUARDIAN.workflow, token, props);
}

function installLineupGuardianScheduler() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'runLineupGuardianScheduler') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('runLineupGuardianScheduler').timeBased().everyMinutes(5).create();
}
