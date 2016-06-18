import gdb
import sys


class ConcatCommand(gdb.Command):
    """Executes a command and print concatenated results with a prefix."""

    def __init__(self):
        super(ConcatCommand, self).__init__("concat", gdb.COMMAND_USER)

    def invoke(self, arg, from_tty):
        pair = arg.partition(' ')
        sys.stdout.write(pair[0] + gdb.execute(pair[2], False, True))
        sys.stdout.flush()

ConcatCommand()

