import gdb
import sys
import json


class BaseCommand(gdb.Command):
    """Base class for custom GDB commands."""

    def __init__(self, name):
        super(BaseCommand, self).__init__("gdbjs-" + name, gdb.COMMAND_USER)
        self.name = name

    def invoke(self, arg, from_tty):
        res = json.dumps(self.action(arg, from_tty), ensure_ascii=False)
        msg = '<gdbjs:cmd:{0} {1} {0}:cmd:gdbjs>'.format(self.name, res)
        sys.stdout.write(msg)
        sys.stdout.flush()
