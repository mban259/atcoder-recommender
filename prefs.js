import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class AtCoderRecommenderPreferences extends ExtensionPreferences {

    fillPreferencesWindow(window) {

        const settings = this.getSettings(
            'org.gnome.shell.extensions.atcoder-recommender'
        );

        const page = new Adw.PreferencesPage();
        window.add(page);

        const group = new Adw.PreferencesGroup({
            title: 'Account'
        });
        page.add(group);

        const row = new Adw.ActionRow({
            title: 'AtCoder Username',
        });

        const entry = new Gtk.Entry({
            text: settings.get_string('username'),
            hexpand: true
        });

        entry.connect('changed', () => {
            settings.set_string('username', entry.text);
        });

        row.add_suffix(entry);
        row.activatable_widget = entry;

        group.add(row);

        const excludeRow = new Adw.ComboRow({
            title: "Exclusion Filter"
        });

        const model = new Gtk.StringList();
        ["All solved", "7 days", "2 weeks", "4 weeks", "6 months", "1 year", "2 years"].forEach(s => model.append(s));
        excludeRow.set_model(model);

        const filter_i = settings.get_int('exclude-filter');

        excludeRow.set_selected(filter_i);

        excludeRow.connect('notify::selected', () => {
            settings.set_int('exclude-filter', excludeRow.get_selected());
        });

        group.add(excludeRow);
    }
}