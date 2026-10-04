// Standalone precision dispatcher. Store GITHUB_WORKFLOW_TOKEN in Script Properties,
// run installLineupGuardianScheduler() once, and keep GitHub's cron as the backup.
const LINEUP_GUARDIAN = {
  owner: 'TheMathNinja',
  repo: 'Chicago-Bears-Lineup-Guardian',
  workflow: 'guardian.yml',
  tokenProperty: 'GITHUB_WORKFLOW_TOKEN',
  alertEmail: 'fili.mikey@gmail.com'
};

function runLineupGuardianScheduler() {
  const now = new Date();
  const minute = now.getMinutes();
  if (minute % 10 >= 5) return; // Five-minute trigger dispatches once in each ten-minute bucket.
  const slot = Math.floor(now.getTime() / 600000);
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('LINEUP_GUARDIAN_SLOT') === String(slot)) return;
  const token = props.getProperty(LINEUP_GUARDIAN.tokenProperty);
  if (!token) throw new Error('Missing ' + LINEUP_GUARDIAN.tokenProperty + ' Script Property.');
  const response = UrlFetchApp.fetch(
    'https://api.github.com/repos/' + LINEUP_GUARDIAN.owner + '/' + LINEUP_GUARDIAN.repo +
      '/actions/workflows/' + LINEUP_GUARDIAN.workflow + '/dispatches',
    {
      method: 'post',
      headers: {Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token,
        'X-GitHub-Api-Version': '2022-11-28'},
      contentType: 'application/json',
      payload: JSON.stringify({ref: 'main', inputs: {live: true}}),
      muteHttpExceptions: true
    }
  );
  if (response.getResponseCode() !== 204) {
    MailApp.sendEmail(LINEUP_GUARDIAN.alertEmail, 'Lineup Guardian dispatch failed',
      'GitHub returned HTTP ' + response.getResponseCode() + ':\n\n' + response.getContentText());
    throw new Error(response.getContentText());
  }
  props.setProperty('LINEUP_GUARDIAN_SLOT', String(slot));
}

function installLineupGuardianScheduler() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'runLineupGuardianScheduler') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('runLineupGuardianScheduler').timeBased().everyMinutes(5).create();
}
