// Standalone precision dispatcher. Store GITHUB_WORKFLOW_TOKEN in Script Properties,
// run installLineupGuardianScheduler() once, and keep GitHub's cron as the backup.
const LINEUP_GUARDIAN = {
  owner: 'TheMathNinja',
  repo: 'Chicago-Bears-Lineup-Guardian',
  workflow: 'guardian.yml',
  initialWorkflow: 'initial-lineup.yml',
  tokenProperty: 'GITHUB_WORKFLOW_TOKEN',
  alertEmail: 'fili.mikey@gmail.com'
};

function runLineupGuardianScheduler() {
  const now = new Date();
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty(LINEUP_GUARDIAN.tokenProperty);
  if (!token) throw new Error('Missing ' + LINEUP_GUARDIAN.tokenProperty + ' Script Property.');
  const slot = String(Math.floor(now.getTime() / 300000));
  if (props.getProperty('LINEUP_GUARDIAN_LAST_SLOT') === slot) return;

  const easternClock = Utilities.formatDate(now, 'America/New_York', 'HH:mm');
  const easternDate = Utilities.formatDate(now, 'America/New_York', 'yyyy-MM-dd');
  if (easternClock >= '06:00' && easternClock < '06:10' &&
      props.getProperty('LINEUP_GUARDIAN_LAST_INITIAL_DATE') !== easternDate) {
    dispatchLineupGuardian_(LINEUP_GUARDIAN.initialWorkflow, token);
    props.setProperty('LINEUP_GUARDIAN_LAST_INITIAL_DATE', easternDate);
  }
  dispatchLineupGuardian_(LINEUP_GUARDIAN.workflow, token);
  props.setProperties({
    LINEUP_GUARDIAN_LAST_SLOT: slot,
    LINEUP_GUARDIAN_LAST_SUCCESS_AT: now.toISOString()
  });
}

function dispatchLineupGuardian_(workflow, token) {
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
    if (lastCode === 204) return;

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
  dispatchLineupGuardian_(LINEUP_GUARDIAN.workflow, token);
}

function installLineupGuardianScheduler() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'runLineupGuardianScheduler') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('runLineupGuardianScheduler').timeBased().everyMinutes(5).create();
}
