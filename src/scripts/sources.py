import gdb
import re


class SourcesCommand(BaseCommand):
    """Search for source files using regex."""

    def __init__(self):
        super(SourcesCommand, self).__init__("sources")

    def action(self, arg, from_tty):
        info = gdb.execute("info sources", False, True)
        # XXX: not sure, whether there is a better way.
        info = re.sub("Reading symbols .*?\.{3}done\.", "", info)
        files = re.findall(r"([/\\].*?)[,\n]", info)
        return [f for f in files if re.search(arg, f)]

gdbjsSources = SourcesCommand()
