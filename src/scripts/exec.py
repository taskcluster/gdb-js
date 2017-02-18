import gdb
import sys
import re


class ExecCommand(BaseCommand):
    """Executes a CLI command and prints results."""

    def __init__(self):
        super(ExecCommand, self).__init__("exec")

    def action(self, arg, from_tty):
        res = gdb.execute(arg, False, True)
        # Results of CLI execution might accidently contain events.
        events = re.findall("<gdbjs:event:.*?:event:gdbjs>", res)
        for e in events: sys.stdout.write(e)
        return res

gdbjsExec = ExecCommand()
