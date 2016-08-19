import gdb


class ThreadCommand(BaseCommand):
    """Returns the current thread."""

    def __init__(self):
        super(ThreadCommand, self).__init__("thread")

    def action(self, arg, from_tty):
        thread = gdb.selected_thread()
        # `global_num` was introduced in GDB 7.11
        num = getattr(thread, 'global_num', None) or thread.num if thread else None
        inferior = gdbjsThreadGroup.action(arg, from_tty)
        return { "id": num or None, "group": inferior }

gdbjsThread = ThreadCommand()
