import gdb
import sys


class BaseCommand(gdb.Command):
    """Base class for custom GDB commands."""

    def __init__(self, name):
        super(BaseCommand, self).__init__("gdbjs-" + name, gdb.COMMAND_USER)

    def invoke(self, arg, from_tty):
        self.action(arg, from_tty)
        sys.stdout.flush()
