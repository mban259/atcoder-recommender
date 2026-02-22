import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup';
import GLib from 'gi://GLib';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

// Constants
const ATCODER_BASE_URL = 'https://atcoder.jp';
const ATCODER_PROBLEMS_API = 'https://kenkoooo.com/atcoder';
const DAY_MAP = [-1, 7, 14, 28, 180, 365, 730];
const MAX_SUBMISSIONS_PER_REQUEST = 500;
const CANDIDATE_POOL_SIZE = 10;
const RANDOM_SELECTION_SIZE = 3;

const IconState = {
    IDLE: 'idle',
    LOADING: 'loading',
    READY: 'ready',
    ERROR: 'error',
    NO_USERNAME: 'no-username'
};

export default class AtCoderRecommenderExtension extends Extension {
    enable() {
        this._indicator = new AtCoderIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}

const AtCoderIndicator = GObject.registerClass(
    class AtCoderIndicator extends PanelMenu.Button {
        _init(extension) {
            super._init(0.0, 'AtCoder Recommender');

            this._extension = extension;
            this._settings = extension.getSettings('org.gnome.shell.extensions.atcoder-recommender');
            this._currentProblem = null;
            this._session = new Soup.Session();

            this._setupUI();
            this._buildMenu();
            this._initializeState();
        }

        _setupUI() {
            this._box = new St.BoxLayout();

            this._icon = new St.Icon({
                icon_name: 'emblem-documents-symbolic',
                style_class: 'system-status-icon'
            });

            this._label = new St.Label({
                text: '',
                y_align: Clutter.ActorAlign.CENTER
            });

            this._box.add_child(this._icon);
            this._box.add_child(this._label);
            this.add_child(this._box);
        }

        _initializeState() {
            const username = this._settings.get_string('username');
            if (username) {
                this._fetchRecommendation();
            } else {
                this._updateDisplay(IconState.NO_USERNAME);
            }
        }

        _buildMenu() {
            this.menu.removeAll();

            this._addProblemItem();
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this._addRefreshItem();
            this._addOpenAtCoderItem();
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            this._addSettingsItem();
        }

        _addProblemItem() {
            const username = this._settings.get_string('username');
            const problemText = this._getProblemText(username);
            
            const problemItem = new PopupMenu.PopupMenuItem(problemText, {
                reactive: !!this._currentProblem
            });

            if (this._currentProblem) {
                problemItem.connect('activate', () => this._openProblemPage());
            }

            this.menu.addMenuItem(problemItem);
        }

        _getProblemText(username) {
            if (!username) return 'Set username in settings';
            if (this._currentProblem) return this._currentProblem.title;
            return 'No problem loaded';
        }

        _openProblemPage() {
            const url = `${ATCODER_BASE_URL}/contests/${this._currentProblem.contest_id}/tasks/${this._currentProblem.id}`;
            Gio.AppInfo.launch_default_for_uri(url, null);
        }

        _addRefreshItem() {
            const refreshItem = new PopupMenu.PopupMenuItem('Refresh');
            refreshItem.connect('activate', () => this._handleRefresh());
            this.menu.addMenuItem(refreshItem);
        }

        _handleRefresh() {
            const username = this._settings.get_string('username');
            if (username) {
                this._fetchRecommendation();
            } else {
                this._resetState();
            }
        }

        _resetState() {
            this._currentProblem = null;
            this._updateDisplay(IconState.NO_USERNAME);
            this._buildMenu();
        }

        _addOpenAtCoderItem() {
            const openAtCoder = new PopupMenu.PopupMenuItem('Open AtCoder');
            openAtCoder.connect('activate', () => {
                Gio.AppInfo.launch_default_for_uri(ATCODER_BASE_URL, null);
            });
            this.menu.addMenuItem(openAtCoder);
        }

        _addSettingsItem() {
            const settingsItem = new PopupMenu.PopupMenuItem('Settings');
            settingsItem.connect('activate', () => this._extension.openPreferences());
            this.menu.addMenuItem(settingsItem);
        }

        _updateDisplay(state) {
            if (state === IconState.READY) {
                this._icon.hide();
                this._label.text = 'AC';
                this._label.show();
            } else {
                const iconMap = {
                    [IconState.IDLE]: 'emblem-documents-symbolic',
                    [IconState.LOADING]: 'emblem-synchronizing-symbolic',
                    [IconState.ERROR]: 'dialog-error-symbolic',
                    [IconState.NO_USERNAME]: 'avatar-default-symbolic'
                };
                this._icon.icon_name = iconMap[state] || 'emblem-documents-symbolic';
                this._icon.show();
                this._label.text = '';
                this._label.hide();
            }
        }

        async _fetchJson(url) {
            return new Promise((resolve, reject) => {
                const message = Soup.Message.new('GET', url);
                this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (sess, result) => {
                    try {
                        const bytes = sess.send_and_read_finish(result);
                        const text = new TextDecoder('utf-8').decode(bytes.get_data());
                        resolve(JSON.parse(text));
                    } catch (e) {
                        reject(e);
                    }
                });
            });
        }

        async _fetchHtml(url) {
            return new Promise((resolve, reject) => {
                const message = Soup.Message.new('GET', url);
                this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (sess, result) => {
                    try {
                        const bytes = sess.send_and_read_finish(result);
                        const text = new TextDecoder('utf-8').decode(bytes.get_data());
                        resolve(text);
                    } catch (e) {
                        reject(e);
                    }
                });
            });
        }

        _parseRating(html) {
            const match = html.match(/<th class="no-break">Rating<\/th><td>.*?<span class='user-[^']+'>([0-9]+)<\/span>/);
            return match ? parseInt(match[1]) : 0;
        }

        async _fetchAllSubmissions(username, fromSecond) {
            const allSubmissions = [];
            let currentFrom = fromSecond;

            while (true) {
                const submissions = await this._fetchJson(
                    `${ATCODER_PROBLEMS_API}/atcoder-api/v3/user/submissions?user=${username}&from_second=${currentFrom}`
                );

                if (submissions.length === 0) break;
                allSubmissions.push(...submissions);
                if (submissions.length < MAX_SUBMISSIONS_PER_REQUEST) break;

                currentFrom = submissions[submissions.length - 1].epoch_second + 1;
            }

            return allSubmissions;
        }

        _getExcludeDaysFromFilter() {
            const filterIndex = this._settings.get_int('exclude-filter');
            return DAY_MAP[filterIndex];
        }

        _calculateFromSecond(excludeDays) {
            return excludeDays === -1 ? 0 : Math.floor((Date.now() - excludeDays * 86400000) / 1000);
        }

        _getSolvedProblemIds(submissions) {
            return new Set(
                submissions
                    .filter(s => s.result === 'AC')
                    .map(s => s.problem_id)
            );
        }

        _filterCandidates(problems, models, solvedIds, userRating) {
            return problems
                .filter(p => !solvedIds.has(p.id) && models[p.id]?.difficulty && !models[p.id]?.is_experimental)
                .map(p => ({
                    ...p,
                    diff: Math.abs(models[p.id].difficulty - userRating)
                }))
                .sort((a, b) => a.diff - b.diff)
                .slice(0, CANDIDATE_POOL_SIZE);
        }

        _selectRandomProblem(candidates) {
            const selectionSize = Math.min(RANDOM_SELECTION_SIZE, candidates.length);
            return candidates[Math.floor(Math.random() * selectionSize)];
        }

        async _fetchRecommendation() {
            const username = this._settings.get_string('username');
            if (!username) return;

            try {
                this._updateDisplay(IconState.LOADING);

                const excludeDays = this._getExcludeDaysFromFilter();
                const fromSecond = this._calculateFromSecond(excludeDays);

                const [userHtml, submissions, problems, models] = await Promise.all([
                    this._fetchHtml(`${ATCODER_BASE_URL}/users/${username}`),
                    this._fetchAllSubmissions(username, fromSecond),
                    this._fetchJson(`${ATCODER_PROBLEMS_API}/resources/problems.json`),
                    this._fetchJson(`${ATCODER_PROBLEMS_API}/resources/problem-models.json`)
                ]);

                const userRating = this._parseRating(userHtml);
                const solvedIds = this._getSolvedProblemIds(submissions);
                const candidates = this._filterCandidates(problems, models, solvedIds, userRating);

                if (candidates.length > 0) {
                    this._currentProblem = this._selectRandomProblem(candidates);
                    this._updateDisplay(IconState.READY);
                } else {
                    this._currentProblem = null;
                    this._updateDisplay(IconState.IDLE);
                }

                this._buildMenu();
            } catch (e) {
                log(`Error: ${e}`);
                this._updateDisplay(IconState.ERROR);
            }
        }
    });
