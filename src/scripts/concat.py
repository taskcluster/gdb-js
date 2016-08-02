import gdb
import sys


class ConcatCommand(BaseCommand):
    """Executes a command and print concatenated results with a prefix."""

    def __init__(self):
        super(ConcatCommand, self).__init__("concat")

    def action(self, arg, from_tty):
        pair = arg.partition(' ')
        sys.stdout.write(pair[0] + gdb.execute(pair[2], False, True))

ConcatCommand()
