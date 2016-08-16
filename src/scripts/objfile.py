import gdb


def new_objfile_handler(event):
    base_event_handler('new-objfile', event.new_objfile.filename)

gdb.events.new_objfile.connect(new_objfile_handler)
