import gdb


class ThreadGroupCommand(BaseCommand):
    """Returns the current thread group."""

    def __init__(self):
        super(ThreadGroupCommand, self).__init__("group")

    def action(self, arg, from_tty):
        inferior = gdb.selected_inferior()
        return { 'id': inferior.num, 'pid': inferior.pid }

gdbjsThreadGroup = ThreadGroupCommand()
