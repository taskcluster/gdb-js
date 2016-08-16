import gdb
import sys


class ExecCommand(BaseCommand):
    """Executes a CLI command and prints results."""

    def __init__(self):
        super(ExecCommand, self).__init__("exec")

    def action(self, arg, from_tty):
        res = gdb.execute(arg, False, True)
        # Results of CLI commands execution might
        # contain events and other stuff, so we need
        # to also expose it to the stdout.
        sys.stdout.write(res)
        return res

ExecCommand()
