import gdb
import sys
import json
import re


class SearchCommand(BaseCommand):
    """Search for source files using regex."""

    def __init__(self):
        super(SearchCommand, self).__init__("search")
        info = gdb.execute('info sources', False, True)
        self.files = info.split('\n\n')[1].split(', ')

    def action(self, arg, from_tty):
        files = [f for f in self.files if re.search(arg, f)]
        sys.stdout.write(json.dumps(files))

SearchCommand()
